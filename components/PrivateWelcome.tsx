"use client";

import { useState, type FormEvent } from "react";
import IcpFiling from "./IcpFiling";
import JournalHeader from "./JournalHeader";

export default function PrivateWelcome({ onLogin, connectionError, onRetry }: { onLogin: (password: string) => Promise<unknown>; connectionError: boolean; onRetry: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try { await onLogin(password); setPassword(""); }
    catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(code === "LOGIN_INVALID" ? "密码不正确，请再试一次。" : code === "LOGIN_RATE_LIMIT" ? "尝试次数较多，请 15 分钟后再试。" : "暂时无法连接，请检查网络后重试。内容不会因此丢失。");
    } finally { setBusy(false); }
  };
  return <main className="private-welcome">
    <JournalHeader title="恋爱日记" eyebrow="A LITTLE SPACE FOR TWO" />
    <section className="private-hero" aria-labelledby="private-title">
      <div className="private-book" aria-hidden="true"><div className="private-book-page"><span>OUR LITTLE STORY</span><b>把日子写成<br />给你的情书</b><i>♡</i><small>ONLY YOU & ME</small></div><span className="private-book-ribbon" /><span className="private-spark">✧</span></div>
      <p className="private-kicker">把喜欢，认真收藏。</p>
      <h1 id="private-title">有些故事，<br />只说给你听<span>。</span></h1>
      <p className="private-description">一页日记，一张照片，一个想一起实现的小愿望。<br />把平凡日子里的心动，留在两个人的空间里。</p>
      <div className="private-features"><span>手写般的日记</span><i>·</i><span>珍藏的照片</span><i>·</i><span>共同的小心愿</span></div>
    </section>
    <section className="private-login" aria-labelledby="private-login-title"><p className="private-kicker">WELCOME HOME</p><h2 id="private-login-title">打开我们的日记</h2><p>仅限已授权的两位记录者。访客只能看到此介绍页。</p>
      <form onSubmit={(event) => void submit(event)}><label htmlFor="private-password">身份密码</label><input id="private-password" type="password" autoComplete="current-password" maxLength={64} placeholder="输入你的身份密码" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy} /><button type="submit" disabled={busy || !password.trim()}>{busy ? "正在打开…" : "进入私密空间"}<span aria-hidden="true"> →</span></button></form>
      {error && <p className="private-error" role="alert">{error}</p>}
      {connectionError && !error && <p className="private-error" role="status">暂时无法验证登录状态。<button type="button" onClick={onRetry}>重新连接</button></p>}
      <small className="private-login-note">登录后记住这台设备 · 不开放注册</small>
    </section>
    <footer className="private-footer">日记与照片，仅在登录后可见。<br /><span>愿每一份认真，都有地方安放。</span><IcpFiling /></footer>
  </main>;
}
