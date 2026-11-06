import assert from "node:assert/strict";
import test from "node:test";
import { paginateBookText } from "../lib/book.ts";
import { bookPartForAnchor, bookAnchorForPart, bookReaderScope, readBookReading, writeBookReading } from "../lib/book-reading.ts";

const store = () => { const data=new Map(); return { getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),data }; };
const example = {diaryId:"example-diary",order:"oldest",kind:"text",offset:7};

test("read-only verified identities stay separate; anonymous demo never inherits a private reader",()=>{
  for(const identity of ["person1","person2"]) {
    assert.equal(bookReaderScope(identity,false,false),identity);
    assert.equal(bookReaderScope(identity,true,false),"guest");
    assert.equal(bookReaderScope(identity,true,true),identity);
  }
});

test("a saved UTF-16 reading anchor survives a cold load and changed viewport, without saving diary text",()=>{
  const data=store(),text="甲乙🌷\n第一段\n\n第二段".repeat(40);
  const small=paginateBookText(text,s=>s.length<=16), large=paginateBookText(text,s=>s.length<=25);
  const anchor=bookAnchorForPart(8,small,true);
  assert.equal(writeBookReading(data,"person1",{...example,...anchor,content:"private",images:["private-photo"]}),true);
  const {reading}=readBookReading(data,"person1");
  assert.deepEqual(Object.keys(reading).sort(),["diaryId","kind","offset","order"]);
  assert.doesNotMatch([...data.data.values()].join(""),/private|photo|第一段/);
  assert.equal(bookPartForAnchor(reading,small,true),8);
  const p=large[bookPartForAnchor(reading,large,true)-1];
  assert.ok(p.start<=anchor.offset && anchor.offset<p.end);
  assert.equal(bookPartForAnchor(reading,[{start:0,end:2},{start:2,end:5}],false),1);
});

test("separate first text and photo pages, including when photos appear or disappear",()=>{
  const pages=[{start:0,end:4},{start:4,end:9}];
  const photo=bookAnchorForPart(0,pages,true), first=bookAnchorForPart(1,pages,true);
  assert.equal(bookPartForAnchor(photo,pages,true),0);
  assert.equal(bookPartForAnchor(photo,pages,false),0);
  assert.equal(bookPartForAnchor(first,pages,true),1);
  assert.equal(bookPartForAnchor({kind:"text",offset:4},pages,true),2);
  assert.equal(bookPartForAnchor(first,[],true),0);
});

test("readers are isolated, anonymous readers do not inherit bookmarks, legacy keys migrate once",()=>{
  const data=store();
  data.setItem("love-diary:book-page","old-id");data.setItem("love-diary:book-order","oldest");
  assert.equal(readBookReading(data,"guest").reading.diaryId,"");
  const old=readBookReading(data,"person2");
  assert.equal(old.reading.diaryId,"old-id");assert.equal(old.reading.order,"oldest");assert.equal(old.legacy,true);
  assert.equal(writeBookReading(data,"person2",old.reading,old.legacy),true);
  assert.equal(data.getItem("love-diary:book-page"),null);
  assert.equal(readBookReading(data,"person1").reading.diaryId,"");
  writeBookReading(data,"person1",example);
  assert.deepEqual(readBookReading(data,"person1").reading,example);
  assert.deepEqual(readBookReading(data,"person2").reading,old.reading);
});

test("blocked and malformed device storage cannot prevent reading or erase legacy state",()=>{
  const data=store();data.setItem("love-diary:book-page","old");
  const blocked={...data,setItem(){throw Error("Full");}};
  assert.equal(writeBookReading(blocked,"person1",example,true),false);
  assert.equal(data.getItem("love-diary:book-page"),"old");
  data.setItem("love-diary:book-reading:v1:person2","null");
  assert.equal(readBookReading(data,"person2").reading.offset,0);
  data.setItem("love-diary:book-reading:v1:person2",JSON.stringify({...example,offset:-1}));
  assert.equal(readBookReading(data,"person2").reading.diaryId,"");
  assert.equal(readBookReading(null,"person1").reading.order,"newest");
});
