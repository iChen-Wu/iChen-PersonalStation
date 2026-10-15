"""批量操作服务"""
from typing import List, Dict
from GYun.data.storage import EntityStorage, TagStorage, FTSStorage
from GYun.data.models.entities import Entity
from GYun.data.storage.database import db
from GYun.data.utils.exceptions import DatabaseError

class BatchService:
    @staticmethod
    def batch_create(data_list: List[dict], on_error: str = 'rollback') -> List[str]:
        ids = []
        with db.atomic() as txn:
            for idx, data in enumerate(data_list):
                try:
                    data = dict(data)  # 浅拷贝：pop 不污染调用者的原始 list 项
                    entity_id = EntityStorage.create(data)
                    tags = data.pop('tags', [])
                    if tags:
                        TagStorage.set_tags(entity_id, tags)
                    FTSStorage.index(entity_id, data.get('title',''), data.get('content'))
                    ids.append(entity_id)
                except Exception as e:
                    if on_error == 'rollback':
                        raise DatabaseError(f"批量创建第{idx}条失败: {e}", original=e)
                    else:
                        continue
        return ids

    @staticmethod
    def batch_update(filters: dict, update_data: dict) -> int:
        from GYun.data.service.query_service import QueryService
        query = Entity.select()
        query = QueryService._apply_filters(query, filters)
        affected = 0
        with db.atomic():
            for entity in query:
                EntityStorage.update(entity.entity_id, update_data)
                # 更新FTS
                FTSStorage.index(entity.entity_id, update_data.get('title', entity.title),
                                 update_data.get('content', entity.content))
                affected += 1
        return affected
