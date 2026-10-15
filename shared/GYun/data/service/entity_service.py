"""实体管理服务层，整合存储、标签、FTS、资源"""
from typing import Dict, Any, Optional
from GYun.data.storage import EntityStorage, TagStorage, FTSStorage, ResourceStorage
from GYun.data.utils.exceptions import EntityNotFoundError
from GYun.data.service.hook_service import HookManager

class EntityService:
    def __init__(self, hooks: HookManager = None):
        self.hooks = hooks or HookManager()

    def create(self, data: dict) -> str:
        data = self.hooks.run_before('create', data)
        data = dict(data)  # 浅拷贝：pop 不污染调用者的原始 dict
        tags = data.pop('tags', [])
        resource_file = data.pop('resource_file', None)
        entity_id = EntityStorage.create(data)
        if tags:
            TagStorage.set_tags(entity_id, tags)
        FTSStorage.index(entity_id, data.get('title',''), data.get('content'))
        if resource_file:
            # V3.0 应用隔离：附件按 data['source'] 落入 resources/{source}/...
            path = ResourceStorage.upload(entity_id, resource_file, source=data.get('source'))
            EntityStorage.update(entity_id, {'resource_path': path})
        self.hooks.run_after('create', entity_id)
        return entity_id

    def get(self, entity_id: str) -> dict:
        entity = EntityStorage.get(entity_id)
        return self._to_dict(entity)

    def update(self, entity_id: str, update_data: dict):
        update_data = self.hooks.run_before('update', update_data)
        update_data = dict(update_data)  # 浅拷贝：pop 不污染调用者的原始 dict
        tags = update_data.pop('tags', None)
        resource_file = update_data.pop('resource_file', None)
        EntityStorage.update(entity_id, update_data)
        if tags is not None:
            TagStorage.set_tags(entity_id, tags)
        entity = EntityStorage.get(entity_id)
        FTSStorage.index(entity_id, entity.title, entity.content)
        if resource_file:
            # V3.0 应用隔离：附件按实体当前 source 落入 resources/{source}/...
            path = ResourceStorage.upload(entity_id, resource_file, source=entity.source)
            EntityStorage.update(entity_id, {'resource_path': path})
        self.hooks.run_after('update', entity_id)

    def delete(self, entity_id: str, hard: bool = False, cascade_resource: bool = True):
        # ✅ 先检查实体是否存在，不存在则抛出 EntityNotFoundError；同时取出 source 供附件清理
        entity = EntityStorage.get(entity_id)  # 内部会抛出 EntityNotFoundError
        self.hooks.run_before('delete', entity_id)
        if hard:
            if cascade_resource:
                ResourceStorage.delete(entity_id, source=entity.source)
            EntityStorage.delete(entity_id, hard=True)
            FTSStorage.remove(entity_id)
        else:
            EntityStorage.delete(entity_id, hard=False)
            FTSStorage.remove(entity_id)
        self.hooks.run_after('delete', entity_id)

    def restore(self, entity_id: str):
        EntityStorage.restore(entity_id)
        entity = EntityStorage.get(entity_id)
        FTSStorage.index(entity_id, entity.title, entity.content)

    def _to_dict(self, entity) -> dict:
        return {
            'entity_id': entity.entity_id,
            'type': entity.type,
            'title': entity.title,
            'content': entity.content,
            'priority': entity.priority,
            'source': entity.source,
            'resource_path': entity.resource_path,
            'extra': entity.extra,
            'related_ids': entity.related_ids,
            'is_deleted': entity.is_deleted,
            'create_time': entity.create_time,
            'update_time': entity.update_time,
        }