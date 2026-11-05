"""Runs the same inputs through reference/*.py and docs/engine.js and compares them."""
import json, random, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'reference'))
import core

BASE=dict(shop='Fern Coffee',product='Iced Latte',price='5.50',currency='USD',offer='',tone='warm')
OFFER=dict(BASE,offer='10% off. Weekdays only. USD 2 off with a mug.')
TEXTS=['Now USD 3.00','50% off today','Free coffee','organic sugar-free latte','cures anxiety','Now USD 5','Now USD50','50 off','5.50% off','organic coffee','Now USD 5.50','USD 10','USD -5.50','USD −5.50','USD －5.50','USD ﹣5.50','USD –5.50','USD —5.50','USD (5.50)','USD 5,500','USD 5 500','USD 5 500','USD 5 500','USD 5’500','USD 1,500.50','USD 1 500.50','USD 1’500.50','USD 5,50','USD --5.50','USD 5.50.00','USD 5,5.50','Iced Latte USD 5.50; special USD −5.50','USD5.50','USD 5.50.','USD +5.50','USD 5.50. Hello','$5.50','£5.50','€5.50 GBP','usd 5.5','USD 005.500','0','-0','USD 0','USD -0','٥','USD ٥.٥٠','５.５０','Ｆree','咖啡free','free咖啡','freedom','FREE','sugar-free','best!','_best_','10%','10 %','+10%','-10%','USD 2','10% off','Weekdays','','   ','USD','$','1.2.3','5.50%','uſd 5.50',"USD 1,000,000",'USD 1,000 000','AUD 5.50','eur 5.50','USD 5.50, come by','(USD 5.50)','USD 5.50 - hello','USD 5.50 (hot)','USD 5.50, 10% off','USD (5.50','USD -']
FRAGS=['USD','GBP','$','£','€','usd',' ',' ','-','−','+','(',')',',','.',"'",'5','50','5.50','10','0','%','free','off','best','today','latte','咖啡','\n','٣','５']
rng=random.Random(20261105)
TEXTS+=[''.join(rng.choice(FRAGS) for _ in range(rng.randint(1,9))) for _ in range(3000)]
INPUTS=[BASE,OFFER,dict(BASE,tone='minimal'),dict(BASE,tone='playful'),dict(BASE,price='5'),dict(BASE,price='005.5'),dict(BASE,price='٥'),dict(BASE,price='0'),dict(BASE,price='0.00'),dict(BASE,price='-1'),dict(BASE,price='nan'),dict(BASE,price='1e9'),dict(BASE,price='1.234'),dict(BASE,price='123456'),dict(BASE,shop='x'*121),dict(BASE,shop='  '),dict(BASE,shop='  Fern  '),dict(BASE,currency='JPY'),dict(BASE,tone='rude'),dict(BASE,offer='y'*241),dict(BASE,offer='Free refill today'),dict(BASE,product='Latte 12oz'),dict(BASE,mode='demo'),dict(BASE,mode='invented'),{},dict(BASE,shop=''),dict(BASE,price=''),dict(BASE,shop=5),dict(BASE,price=5.5),{'shop':'a','product':'b','price':'1'}]
corpus=dict(base=BASE,offer=OFFER,texts=TEXTS,inputs=INPUTS)

def py_run(fn,*args):
    try: return {'ok':fn(*args)}
    except ValueError: return {'error':True}
def strip_times(r):
    if isinstance(r,dict): return {k:strip_times(v) for k,v in r.items() if k!='elapsed_ms'}
    if isinstance(r,list): return [strip_times(v) for v in r]
    return r
def py_agent(data):
    r=core.run_agent(data)
    return r
facts=core.validate(BASE); offer_facts=core.validate(OFFER)
expected=dict(
    audit=[core.audit(t,facts) for t in TEXTS],
    audit_offer=[core.audit(t,offer_facts) for t in TEXTS],
    validate=[py_run(core.validate,d) for d in INPUTS],
    agent=[strip_times(py_run(py_agent,d)) for d in INPUTS],
    markdown=[core.export_markdown(core.generate(BASE)),core.export_markdown(core.generate(OFFER))],
)
out=subprocess.run(['node',str(ROOT/'tests/differential.cjs')],input=json.dumps(corpus),capture_output=True,text=True,check=True).stdout
actual=json.loads(out)
fails=0
for key,exp in expected.items():
    for i,(a,b) in enumerate(zip(actual[key],exp)):
        if a!=b:
            fails+=1
            if fails<=15: print('DIFF',key,repr((TEXTS+TEXTS)[i] if key.startswith('audit') else i),'\n  js',a,'\n  py',b)
    assert len(actual[key])==len(exp)
total=sum(len(v) for v in expected.values())
print(f'{total-fails}/{total} identical between Python and JS')
sys.exit(1 if fails else 0)
