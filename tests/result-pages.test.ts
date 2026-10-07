import {expect,it} from 'vitest';
import {mergeResultPage,resultPageKey} from '../packages/workbench/src/result-pages.js';
const page=(value:number,nextCursor:string|null=null)=>({columns:['value'],rows:[[value]],nextCursor,truncated:false});
it('keeps late pages isolated by execution and result-set identity',()=>{
 let cache=mergeResultPage({},'new',0,page(202));cache=mergeResultPage(cache,'old',0,page(101));cache=mergeResultPage(cache,'new',1,page(303));
 expect(cache[resultPageKey('new',0)].rows).toEqual([[202]]);expect(cache[resultPageKey('new',1)].rows).toEqual([[303]]);
});
it('ignores duplicated/out-of-order cursors and late initial responses',()=>{
 const initial=mergeResultPage({},'one',0,page(1,'cursor1'));
 expect(mergeResultPage(initial,'one',0,page(3),'cursor2')).toBe(initial);
 const next=mergeResultPage(initial,'one',0,page(2),'cursor1');
 expect(next[resultPageKey('one',0)].rows).toEqual([[1],[2]]);
 expect(mergeResultPage(next,'one',0,page(2),'cursor1')).toBe(next);
 expect(mergeResultPage(next,'one',0,page(1,'cursor1'))).toBe(next);
});
