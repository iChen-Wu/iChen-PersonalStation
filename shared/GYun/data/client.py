"""统一客户端入口 GyunClient"""
from typing import List, Dict, Any, Optional, Iterator
from GYun.data.service.memory_service import MemoryService
from GYun.data.storage.database import init_db, close_db
from GYun.data.service.entity_service import EntityService
from GYun.data.service.query_service import QueryService
from GYun.data.service.batch_service import BatchService
from GYun.data.service.maintenance_service import MaintenanceService
from GYun.data.service.hook_service import HookManager
import logging

from GYun.data.storage import ResourceStorage
from GYun.data.storage.resource_storage import validate_source
from GYun.data.utils.exceptions import *

class GyunClient:
    def __init__(self, source: Optional[str] = None, enable_history: bool = False):
        # ✅ V3.0 应用隔离：source 作为「应用标识」，实例化后所有 create/query 自动注入该过滤
        # source=None 时为全局模式（不做过滤），保证老脚本 100% 兼容
        self._source = validate_source(source)
        # ✅ V2.1 核心防线：所有 Service 必须在此处延迟导入，彻底杜绝循环依赖和 UnboundLocalError！
        # 导入语句必须集中在最顶部，绝不能和赋值语句穿插！
        from GYun.data.storage.database import init_db
        from GYun.data.service.hook_service import HookManager
        from GYun.data.service.entity_service import EntityService
        from GYun.data.service.query_service import QueryService
        from GYun.data.service.batch_service import BatchService
        from GYun.data.service.maintenance_service import MaintenanceService
        from GYun.data.service.memory_service import MemoryService  # V2.1新增
        from GYun.data.service.knowledge_service import KnowledgeService

        # ================= 原有逻辑初始化 (严格保留原版结构) =================
        self._logger = logging.getLogger("gyun.client")
        self._hooks = HookManager()
        self._entity_service = EntityService(self._hooks)
        self._query_service = QueryService()
        self._batch_service = BatchService()
        self._maintenance = MaintenanceService()  # 原版逻辑：实例化并作为内部属性
        
        # 数据库初始化 (必须在 Service 实例化之后，确保表结构安全建立)
        init_db(enable_history=enable_history)
        
        # ================= V2.1 新增逻辑挂载 =================
        # 记忆引擎：需要传入 client 自身以便调用底层 CRUD
        self.memory = MemoryService(self)
        self.knowledge = KnowledgeService(self)
        
        # 运维对外暴露：将内部的 _maintenance 映射为公开属性，供新 demo 及外部直接调用
        self.maintenance = self._maintenance
        
    # ---- 应用上下文 ----
    @property
    def source(self) -> Optional[str]:
        """当前应用标识；None 表示全局模式"""
        return self._source

    def set_source(self, source: Optional[str]):
        """切换应用上下文。None 表示全局模式（不做过滤，兼容老脚本）。"""
        self._source = validate_source(source)

    def _inject_source(self, payload: dict) -> dict:
        """应用模式下自动注入 source 过滤；全局模式原样返回。浅拷贝注入，不改调用者的 dict。"""
        if self._source is not None and 'source' not in payload:
            payload = dict(payload)
            payload['source'] = self._source
        return payload

    # ---- 实体管理 ----
    def create_entity(self, data: dict) -> str:
        data = self._inject_source(data)
        return self._entity_service.create(data)

    def get_entity(self, entity_id: str) -> dict:
        return self._entity_service.get(entity_id)

    def update_entity(self, entity_id: str, update_data: dict):
        self._entity_service.update(entity_id, update_data)

    def delete_entity(self, entity_id: str, hard: bool = False, cascade_resource: bool = True):
        self._entity_service.delete(entity_id, hard, cascade_resource)

    def restore_entity(self, entity_id: str):
        self._entity_service.restore(entity_id)

    # ---- 查询 ----
    def query_entities(self, filters: dict = None,
                       order_by: str = "create_time",
                       order: str = "desc",
                       page: int = 1,
                       page_size: int = 20) -> dict:
        return self._query_service.query(self._inject_source(dict(filters or {})), order_by, order, page, page_size)

    def fulltext_search(self, keyword: str, filters: dict = None,
                        order_by: str = "relevance",
                        page: int = 1,
                        page_size: int = 20) -> dict:
        return self._query_service.fulltext_search(keyword, self._inject_source(dict(filters or {})), order_by, page, page_size)

    def get_entities_batch(self, entity_ids: List[str]) -> List[dict]:
        return self._query_service.get_entities_batch(entity_ids)

    def get_related_entities(self, entity_id: str) -> List[dict]:
        return self._query_service.get_related_entities(entity_id)

    def get_referenced_entities(self, entity_id: str) -> List[dict]:
        return self._query_service.get_referenced_entities(entity_id)

    def count_entities(self, filters: dict = None) -> int:
        return self._query_service.count(self._inject_source(dict(filters or {})))

    def group_count(self, group_by: str = "type", filters: dict = None) -> List[Dict]:
        return self._query_service.group_count(group_by, self._inject_source(dict(filters or {})))

    def iter_all_entities(self, filters: dict = None, batch_size: int = 100) -> Iterator[dict]:
        return self._query_service.iter_all(self._inject_source(dict(filters or {})), batch_size)



    # ---- 附件 ----
    def upload_resource(self, entity_id: str, file_path: str) -> str:
        # V3.0 应用隔离：优先按实体自身的 source 归属，其次按客户端应用上下文
        entity = self._entity_service.get(entity_id)
        return ResourceStorage.upload(entity_id, file_path, source=entity.get('source') or self._source)

    def get_resource_path(self, entity_id: str) -> Optional[str]:
        entity = self._entity_service.get(entity_id)
        if entity.get('resource_path'):
            # V3.0 双路径回退：优先新路径 resources/{source}/...，缺失时回退旧路径
            return ResourceStorage.get_path(entity_id, entity['resource_path'],
                                            source=entity.get('source') or self._source)
        return None

    def delete_resource(self, entity_id: str):
        entity = self._entity_service.get(entity_id)
        ResourceStorage.delete(entity_id, source=entity.get('source') or self._source)
        self._entity_service.update(entity_id, {'resource_path': None})

    # ---- 批量 ----
    def batch_create_entities(self, data_list: List[dict], on_error: str = "rollback") -> List[str]:
        data_list = [self._inject_source(item) for item in data_list]  # 注入 source（每项浅拷贝）
        return self._batch_service.batch_create(data_list, on_error)

    def batch_update_entities(self, filters: dict, update_data: dict) -> int:
        return self._batch_service.batch_update(self._inject_source(dict(filters or {})), update_data)

    # ---- 运维 ----
    def backup(self) -> str:
        return self._maintenance.backup()

    def delete_application(self, source: str, cascade_resource: bool = True) -> int:
        """
        【V3.0 新增】一键删除应用：硬删主表（级联清除向量/边/标签）
        并物理删除附件目录 resources/{source}/，实现烂尾项目彻底清理。
        返回被删除的实体数量。
        """
        return self._maintenance.delete_application(source, cascade_resource)

    def restore(self, backup_file: str):
        self._maintenance.restore(backup_file)

    def vacuum(self):
        self._maintenance.vacuum()

    def integrity_check(self) -> dict:
        return self._maintenance.integrity_check()

    def gc(self, execute: bool = False) -> list:
        return self._maintenance.gc(execute)

    # ---- 钩子 ----
    def register_hook(self, hook_type: str, func: callable):
        self._hooks.register(hook_type, func)

    def close(self):
        close_db()
