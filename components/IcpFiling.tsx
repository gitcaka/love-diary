"use client";

/** The deployment supplies its own verified filing number, not the demo build. */
export default function IcpFiling() {
  const number = typeof document === "undefined" ? "" : document.querySelector<HTMLMetaElement>('meta[name="love-diary-icp"]')?.content.trim();
  if (!number) return null;
  return <a className="icp-filing" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{number}</a>;
}
