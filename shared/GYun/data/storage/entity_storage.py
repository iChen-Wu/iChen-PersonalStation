"""实体CRUD存储层"""
import json
from typing import List, Dict, Any, Optional
from peewee import DoesNotExist, fn
from GYun.data.models.entities import Entity
from GYun.data.utils.exceptions import EntityNotFoundError, DatabaseError
from GYun.data.utils.id_gen import generate_entity_id
from GYun.data.utils.time_utils import get_current_ms

class EntityStorage:
    @staticmethod
    def create(data: dict) -> str:
        entity_id = generate_entity_id()
        now = get_current_ms()
        defaults = {
            'entity_id': entity_id,
            'create_time': now,
            'update_time': now,
            'is_deleted': 0,
            'extra': {},
            'related_ids': [],
            'priority': 0,
        }
        defaults.update(data)
        # 内部字段不允许由外部数据覆盖（id/创建时间由系统生成）
        defaults['entity_id'] = entity_id
        defaults['create_time'] = now
        # V3.0 应用标识写入统一校验（覆盖 client/batch/memory 全部写入路径）
        if 'source' in defaults and defaults['source'] is not None:
            from GYun.data.storage.resource_storage import validate_source
            defaults['source'] = validate_source(defaults['source'])
        try:
            Entity.create(**defaults)
        except Exception as e:
            raise DatabaseError(f"创建实体失败: {e}", original=e)
        return entity_id

    @staticmethod
    def get(entity_id: str) -> Entity:
        try:
            return Entity.get_by_id(entity_id)
        except DoesNotExist:
            raise EntityNotFoundError(f"实体 {entity_id} 不存在")

    @staticmethod
    def update(entity_id: str, update_data: dict):
        try:
            entity = Entity.get_by_id(entity_id)
        except DoesNotExist:
            raise EntityNotFoundError(f"实体 {entity_id} 不存在")
        now = get_current_ms()
        # 深度合并 extra
        if 'extra' in update_data and isinstance(update_data['extra'], dict):
            old_extra = entity.extra or {}
            new_extra = {**old_extra, **update_data['extra']}
            update_data['extra'] = new_extra
        update_data['update_time'] = now
        # V3.0 应用标识写入统一校验
        if 'source' in update_data and update_data['source'] is not None:
            from GYun.data.storage.resource_storage import validate_source
            update_data['source'] = validate_source(update_data['source'])
        query = Entity.update(**update_data).where(Entity.entity_id == entity_id)
        query.execute()

    @staticmethod
    def delete(entity_id: str, hard: bool = False):
        if hard:
            Entity.delete_by_id(entity_id)
        else:
            Entity.update(is_deleted=1, update_time=get_current_ms()).where(
                Entity.entity_id == entity_id).execute()

    @staticmethod
    def restore(entity_id: str):
        Entity.update(is_deleted=0, update_time=get_current_ms()).where(
            Entity.entity_id == entity_id).execute()

    @staticmethod
    def exists(entity_id: str) -> bool:
        return Entity.select().where(Entity.entity_id == entity_id).exists()
    @staticmethod
    def get_entities_batch(entity_ids: list) -> dict:
        """
        【V2.1 新增】批量获取实体核心字段，返回以 entity_id 为键的字典
        专为混合召回设计，不拉取无用字段（如 resource_path），提速内存计算
        """
        if not entity_ids:
            return {}
            
        # 仅查询计算分数所需的字段
        query = Entity.select(
            Entity.entity_id, Entity.content, Entity.extra, 
            Entity.create_time, Entity.update_time
        ).where(Entity.entity_id << entity_ids)
        
        result = {}
        for entity in query.execute():
            # 处理 extra 字段：确保它一定是 dict 格式
            extra_data = entity.extra
            if isinstance(extra_data, str):
                try:
                    extra_data = json.loads(extra_data)
                except json.JSONDecodeError:
                    extra_data = {}
            elif extra_data is None:
                extra_data = {}
                
            result[entity.entity_id] = {
                'entity_id': entity.entity_id,
                'content': entity.content,
                'extra': extra_data,
                'create_time': entity.create_time,
                'update_time': entity.update_time
            }
        return result
    
