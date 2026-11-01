import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../app/compact-ui.css',import.meta.url),'utf8');
const rule=selector=>{
  const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const matches=[...css.matchAll(new RegExp(escaped+'\\s*\\{([^}]+)\\}','g'))];
  assert.ok(matches.length,selector);return matches.at(-1)[1].replace(/\s+/g,'');
};
const requires=(selector,properties)=>{const body=rule(selector);for(const prop of properties)assert.ok(body.includes(prop),selector+' '+prop);};
test('book actions and gallery filters keep explicit centered alignment',()=>{
  requires('.app-shell.compact-ui .book-controls button',['align-items:center','justify-content:center','min-width:0']);
  requires('.app-shell.compact-ui .book-edit-current',['flex:none','min-width:44px','white-space:nowrap']);
  requires('.app-shell.compact-ui .gallery-page .filter-pills button',['justify-content:center','min-height:44px']);
});
test('photo removal is separate from the narrow-card ordering row',()=>{
  requires('.app-shell.compact-ui .photo-sort-list',['repeat(2,minmax(0,1fr))']);
  requires('.app-shell.compact-ui .photo-controls',['display:grid','grid-template-columns:44pxminmax(0,1fr)44px']);
  requires('.app-shell.compact-ui .photo-controls .delete-mini',['position:absolute','top:6px','right:6px']);
  requires('.app-shell.compact-ui .photo-controls button',['width:44px','height:44px']);
});
test('book ribbon reserves space away from mood text',()=>{
  requires('.app-shell.compact-ui .book-ribbon',['right:12px','width:16px']);
  requires('.app-shell.compact-ui .book-day-feeling',['flex:none','padding-right:18px']);
});
