"""In-memory receipts for local review; not user authentication."""
import hashlib,json,secrets
from datetime import datetime,timezone
from core import validate,parse_model,quality,export_markdown,AgentError
GENERATIONS={}; REVIEWS={}
def remember(store,value):
    if len(store)>=256: store.pop(next(iter(store)))
    key=secrets.token_urlsafe(24); store[key]=value; return key

def register(r):
    if 'facts' in r: r['generation_id']=remember(GENERATIONS,dict(r))
    return r

def snapshot(d):
    if d.get('mode') not in ['demo','live']: raise ValueError('模式须为demo或live')
    source=GENERATIONS.get(d.get('generation_id'))
    if not source or d['mode']!=source['mode'] or validate(d['facts'])!=source['facts']:
        raise AgentError('SOURCE_CHANGED','生成来源或事实已变化，请重新生成。')
    r=parse_model(json.dumps(d)); r.update({k:source[k] for k in ['facts','mode','label','trace','call_count','model','workflow_version','elapsed_ms','cost','generation_id'] if k in source})
    for k in ['revision','asset_revision']:
        if type(d.get(k)) is not int or d[k]<0: raise ValueError('缺少内容或图片版本')
        r[k]=d[k]
    r['flags']=quality(r,r['facts'])
    return r

def digest(r): return hashlib.sha256(json.dumps(r,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
def review(d):
    r=snapshot(d)
    token=remember(REVIEWS,{'digest':digest(r),'checked_at':datetime.now(timezone.utc).isoformat()})
    return {'flags':r['flags'],'audit_id':token}
def export(d):
    r=snapshot(d); receipt=REVIEWS.get(d.get('audit_id'))
    if d.get('confirmed') is not True or not receipt or receipt['digest']!=digest(r):
        raise AgentError('REVIEW_STALE','人工确认缺失或版本已变，请重新检查并确认。')
    r['review']={'confirmed':True,'revision':r['revision'],'asset_revision':r['asset_revision'],'checked_at':receipt['checked_at'],'confirmed_at':datetime.now(timezone.utc).isoformat(),'accepted_flags':r['flags']}
    return {'result':r,'markdown':export_markdown(r)+'\n## 审核记录\n'+json.dumps(r['review'],ensure_ascii=False,indent=2)+'\n\n## 流程记录\n'+json.dumps(r.get('trace',[]),ensure_ascii=False,indent=2)}
