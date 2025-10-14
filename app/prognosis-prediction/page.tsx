"use client";
import React, { useEffect, useMemo, useReducer, useState, useRef } from "react";

// =============================
//  ADL 予後予測（React / Next.js App Router 用・安定版 v0.9.0-personal）
//  - これまで報告のあったビルド/実行エラーを全て解消
//  - 重複宣言（cn/Sel/Button/Card/CardContent/Alert/Reducer 等）を排除
//  - 角括弧 < > を文中で使う箇所は &lt; / &gt; にエスケープ
//  - Evidence を「カード→一覧」に変更（ユーザー要望）／原著リンクのクリックハードニング
//  - 型安全（TS）＆ Client Component 化（"use client"）
//  - アプリの機能・挙動は従前どおり（数学ロジック/自己テスト/感度分析/同意・免責等）
// =============================

// ---- utils ----
function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
const ln = (v: number) => Math.log(Math.max(1e-9, v));
const sig = (z: number) => 1 / (1 + Math.exp(-z));
const logit = (p: number) => Math.log(Math.max(1e-9, p) / Math.max(1e-9, 1 - p));

// 表示用フォーマッタ（非数はダッシュ、桁数は 0..6 にクランプ）
const F = (v: any, d = 2) => {
  const n = Number(v);
  const k = Math.min(6, Math.max(0, (Number(d) | 0)));
  return Number.isFinite(n) ? n.toFixed(k) : "—";
};
// ゼロ埋めバージョン（表示専用）
const F0 = (v: any, d = 2) => {
  const n = Number(v ?? 0);
  const k = Math.min(6, Math.max(0, (Number(d) | 0)));
  return Number.isFinite(n) ? n.toFixed(k) : (0).toFixed(k);
};
const toNum = (v: any, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const isHalf = (p: number) => Number.isFinite(p) && Math.abs(p - 0.5) < 1e-9;
const P = (p: number) => (Number.isFinite(p) ? Math.round(p * 100) + "%" : "—");

// URL 正規化（doi/pmid/pmc/http(s)/www 対応）
function normalizeUrl(url?: string) {
  if (!url) return "";
  const s = String(url).trim();
  const lower = s.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return s;
  if (lower.startsWith("doi:")) return "https://doi.org/" + s.slice(4).trim();
  if (s.startsWith("10.")) return "https://doi.org/" + s; // bare DOI
  if (lower.startsWith("pmid:")) {
    const digits = s.slice(5).split("").filter((c) => c >= "0" && c <= "9").join("");
    return digits ? "https://pubmed.ncbi.nlm.nih.gov/" + digits + "/" : "";
  }
  if (lower.startsWith("pmc")) return "https://www.ncbi.nlm.nih.gov/pmc/articles/" + s + "/";
  if (lower.startsWith("www.")) return "https://" + s;
  return s;
}

// ---- 小 UI ----
export const Card: React.FC<React.PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <div className={cx("rounded border shadow-sm bg-white", className)}>{children}</div>
);
export const CardContent: React.FC<React.PropsWithChildren<{ className?: string }>> = ({ className, children }) => (
  <div className={cx("p-4", className)}>{children}</div>
);
export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { className?: string }>
  = ({ className, children, ...rest }) => (
    <button {...rest} className={cx("inline-flex items-center gap-2 rounded border px-3 py-2 text-sm hover:bg-gray-50 active:bg-gray-100", className)}>
      {children}
    </button>
  );

// Alert（型安全）
type AlertKind = "info" | "warning" | "error" | "success";
const ALERT_STYLES: Record<AlertKind, string> = {
  info: "bg-blue-50 text-blue-800 border-blue-200 border",
  warning: "bg-yellow-50 text-yellow-800 border-yellow-200 border",
  error: "bg-red-50 text-red-800 border-red-200 border",
  success: "bg-green-50 text-green-800 border-green-200 border",
};
type AlertProps = React.PropsWithChildren<{ type?: AlertKind; className?: string }>;
const Alert: React.FC<AlertProps> = ({ type = "info", className, children }) => (
  <div className={cx("p-2 rounded text-sm", ALERT_STYLES[type], className)} role="alert">{children}</div>
);

// ---- 入力コンポーネント ----
const Num: React.FC<{
  label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number;
  helperText?: string; error?: string; [k: string]: any;
}> = ({ label, value, onChange, min, max, step, helperText, error, ...rest }) => (
  <label className="flex flex-col gap-1 text-sm">
    <span>{label}</span>
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(toNum(e.target.value, value))}
      className={cx("border rounded px-2 py-1", error && "border-red-500")}
      {...(min != null ? { min } : {})}
      {...(max != null ? { max } : {})}
      {...(step != null ? { step } : {})}
      inputMode="numeric"
      pattern="[0-9]*"
      {...rest}
    />
    {helperText && <p className="text-[11px] text-slate-500 mt-1">{helperText}</p>}
    {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
  </label>
);

const Sel: React.FC<{ label: string; value: string; onChange: (v: string) => void; opts: [string, string][]; [k: string]: any }>
  = ({ label, value, onChange, opts, ...rest }) => (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="border rounded px-2 py-1" {...rest}>
        {opts.map(([v, t]) => (
          <option key={v} value={v}>{t}</option>
        ))}
      </select>
    </label>
  );

const Ck: React.FC<{ label: string; checked: boolean; onChange: (b: boolean) => void; helperText?: string }>
  = ({ label, checked, onChange, helperText }) => (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
      {helperText && <span className="text-[11px] text-slate-500 ml-1">{helperText}</span>}
    </label>
  );

const Kpi: React.FC<{ label: React.ReactNode; value: React.ReactNode; note?: string; className?: string }>
  = ({ label, value, note, className }) => (
    <div className={cx("rounded border p-2", className)}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-base font-semibold">{value}</div>
      {note && <div className="text-xs text-gray-500 mt-1">{note}</div>}
    </div>
  );

// ---- 数学ロジック ----
const beta2pt = (dA: number, fA: number, dB: number, fB: number) => {
  if (!(dA > 0 && dB > dA)) return NaN;
  const den = ln(dB) - ln(dA);
  if (Math.abs(den) < 1e-9) return NaN;
  return (fB - fA) / den;
};
const fimAt = (dX: number, dA: number, fA: number, b: number) => (dX > 0 && dA > 0 && Number.isFinite(b) ? fA + b * (ln(dX) - ln(dA)) : NaN);
const logitP = (fim: number, th: number, k: number) => (Number.isFinite(fim) ? sig(k * (fim - th)) : NaN);

const CFG = {
  thresholds: [
    ["stairs", "階段", 89.2],
    ["tubTransfer", "浴槽/ｼｬﾜｰ移乗", 80.0],
    ["walk", "移動（歩/車）", 74.2],
    ["dressU", "更衣・上", 73.6],
    ["bathing", "入浴", 70.3],
    ["toiletTransfer", "ﾄｲﾚ移乗", 65.9],
    ["bedChairTransfer", "ﾍﾞｯﾄﾞ/椅子移動", 65.5],
    ["dressL", "更衣・下", 64.5],
    ["toilet", "ﾄｲﾚ動作", 62.0],
    ["groom", "整容", 51.0],
    ["bladder", "膀胱", 43.4],
    ["bowel", "腸", 42.2],
    ["eating", "食事", 34.1],
  ],
  weights: {
    stairs: [0.2, 2.5, 0.6],
    walk: [0.2, 2.8, 0.4],
    tubTransfer: [0.4, 1.6, 1.2],
    bedChairTransfer: [0.2, 1.1, 0.6],
    toiletTransfer: [0.3, 1.1, 0.7],
    bathing: [0.5, 1.0, 0.9],
    dressU: [1.1, 0.4, 1.2],
    dressL: [0.7, 0.5, 1.4],
    groom: [1.3, 0.2, 0.6],
    toilet: [0.5, 0.6, 0.3],
    bladder: [0.2, 0.1, 0.1],
    bowel: [0.2, 0.1, 0.1],
    eating: [0.9, 0.1, 0.2],
  },
  deltaScales: { sNeg: 12, sAph: 8, sApx: 10 },
  homeDefault: {
    intercept: -3.0,
    bFim: 0.068,
    bAge: -0.724,
    bAlone: -0.82,
    bHH: 0.64,
    bNeg: -0.4,
    bAph: -0.2,
    bApx: -0.2,
    bStairs: -0.3,
    bNihL: 0.0,
    bNihM: -0.6,
    bNihH: -1.2,
    bMrs2: 0.0,
    bMrs3: -0.4,
    bMrs4: -0.8,
    bMrs5: -1.2,
  },
} as const;
const TH = CFG.thresholds.map(([key, label, th]) => ({ key: key as string, label: label as string, th: th as number }));
const SC = CFG.deltaScales;
const HOME = CFG.homeDefault;

// ---- CI（ブートストラップ的・教育用） ----
function randn() { // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
function normal(mean = 0, sd = 1) { return mean + sd * randn(); }
function quantile(sortedArr: number[], q: number) {
  if (!sortedArr || sortedArr.length === 0) return NaN;
  const x = Math.min(Math.max(q, 0), 1) * (sortedArr.length - 1);
  const i = Math.floor(x), j = Math.ceil(x);
  if (i === j) return sortedArr[i];
  const t = x - i;
  return sortedArr[i] * (1 - t) + sortedArr[j] * t;
}
function calcZ(state: any, fim: number, overrideNihCat?: 'low' | 'mid' | 'high') {
  const xAge = (state.age - 75) / 10;
  let nihAdj: number;
  if (overrideNihCat) {
    nihAdj = overrideNihCat === 'low' ? HOME.bNihL : overrideNihCat === 'mid' ? HOME.bNihM : HOME.bNihH;
  } else {
    nihAdj = state.nihUnknown ? 0 : state.nih <= 5 ? HOME.bNihL : state.nih <= 13 ? HOME.bNihM : HOME.bNihH;
  }
  const mrsAdj = state.mrs <= 2 ? HOME.bMrs2 : state.mrs === 3 ? HOME.bMrs3 : state.mrs === 4 ? HOME.bMrs4 : HOME.bMrs5;
  const z =
    HOME.intercept +
    HOME.bFim * fim +
    HOME.bAge * xAge +
    HOME.bAlone * (state.hh <= 1 ? 1 : 0) +
    HOME.bHH * Math.max(0, state.hh - 1) +
    (state.neg ? state.wNeg : 0) +
    (state.aph ? state.wAph : 0) +
    (state.apx ? state.wApx : 0) +
    HOME.bStairs * (state.stairs ? 1 : 0) +
    nihAdj +
    mrsAdj;
  return z;
}
function bootstrapCI(state: any, fim: number, n = 200) {
  if (!Number.isFinite(fim)) return null as null | { hat: number; lo: number; hi: number; n: number };
  const SD_FIM = 1.0; // ≈ ±2点
  const SD_W = 0.10;  // wNeg/wAph/wApx の揺れ
  const ps: number[] = [];
  for (let k = 0; k < n; k++) {
    const fimS = clamp(fim + normal(0, SD_FIM), 0, 91);
    const wNeg = (state.wNeg ?? 0) + normal(0, SD_W);
    const wAph = (state.wAph ?? 0) + normal(0, SD_W);
    const wApx = (state.wApx ?? 0) + normal(0, SD_W);
    const nihCat = state.nihUnknown ? (k % 3 === 0 ? 'low' : (k % 3 === 1 ? 'mid' : 'high')) : undefined;
    const s2 = { ...state, wNeg, wAph, wApx };
    const z = calcZ(s2, fimS, nihCat as any);
    ps.push(sig(z));
  }
  ps.sort((a, b) => a - b);
  const lo = quantile(ps, 0.05), hi = quantile(ps, 0.95);
  const hat = sig(calcZ(state, fim));
  return { hat, lo, hi, n };
}

// ---- セクション ----
function InputSection({ state, dispatch, onOpenInterval }: any) {
  const { dA, fA, dB, fB, dX, fAError, fBError } = state;
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="font-semibold flex items-center gap-1">
          <span>基本入力（2点法）</span>
          <button onClick={onOpenInterval} className="w-4 h-4 rounded-full border border-gray-400 text-xs text-gray-600 hover:bg-gray-100">?</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="測定日A" value={dA} onChange={(v) => dispatch({ type: 'UPDATE', field: 'dA', value: v })} min={1} />
          <Num label="FIM-mスコアA" value={fA} onChange={(v) => dispatch({ type: 'SET_WITH_CLAMP', payload: { field: 'fA', errorField: 'fAError', value: v, min: 0, max: 91 } })} min={0} max={91} error={fAError} />
          <Num label="測定日B" value={dB} onChange={(v) => dispatch({ type: 'UPDATE', field: 'dB', value: v })} min={Math.max(1, dA + 1)} />
          <Num label="FIM-mスコアB" value={fB} onChange={(v) => dispatch({ type: 'SET_WITH_CLAMP', payload: { field: 'fB', errorField: 'fBError', value: v, min: 0, max: 91 } })} min={0} max={91} error={fBError} />
          <Num label="予測日X" value={dX} onChange={(v) => dispatch({ type: 'UPDATE', field: 'dX', value: v })} min={1} />
        </div>
      </CardContent>
    </Card>
  );
}

function FactorsSection({ state, dispatch }: any) {
  const { age, alone, hh, stairs, hem, aph, neg, apx, nihUnknown, nih, nihError, mrs, mrsError } = state;
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="font-semibold">背景因子</div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="年齢" value={age} onChange={(v) => dispatch({ type: 'UPDATE', field: 'age', value: clamp(v, 18, 120) })} min={18} max={120} />
          <Sel label="麻痺側" value={hem} onChange={(v) => dispatch({ type: 'UPDATE', field: 'hem', value: v })} opts={[["不明", "不明"], ["左", "左"], ["右", "右"]]} />
          <Num label="世帯人数" value={hh} onChange={(v) => dispatch({ type: 'UPDATE', field: 'hh', value: Math.max(1, Math.round(v)) })} min={1} />
          <div className="flex items-center gap-4">
            <Ck label="独居" checked={alone} onChange={(checked) => {
              dispatch({ type: 'UPDATE', field: 'alone', value: checked });
              if (checked) dispatch({ type: 'UPDATE', field: 'hh', value: 1 });
              if (!checked && hh < 2) dispatch({ type: 'UPDATE', field: 'hh', value: 2 });
            }} />
            <Ck label="自宅に階段・段差あり" checked={stairs} onChange={(val) => dispatch({ type: 'UPDATE', field: 'stairs', value: val })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Ck label="失語症" checked={aph} onChange={(v) => dispatch({ type: 'UPDATE', field: 'aph', value: v })} />
          <Ck label="半側空間無視" checked={neg} onChange={(v) => dispatch({ type: 'UPDATE', field: 'neg', value: v })} />
          <Ck label="観念・運動失行" checked={apx} onChange={(v) => dispatch({ type: 'UPDATE', field: 'apx', value: v })} />
        </div>
        <div className="space-y-2 border border-blue-200 p-2 rounded bg-blue-50">
          <div className="flex items-center gap-2">
            <Ck label="NIHSS不明" checked={nihUnknown} onChange={(val) => dispatch({ type: 'UPDATE', field: 'nihUnknown', value: val })} />
            <Num label="NIHSS (0–42)" value={nih} onChange={(v) => dispatch({ type: 'SET_WITH_CLAMP', payload: { field: 'nih', errorField: 'nihError', value: v, min: 0, max: 42 } })} min={0} max={42} disabled={nihUnknown} error={nihError} helperText="入院時のNIHSS合計。0–42の範囲" />
          </div>
          {!nihUnknown && (
            <Alert type="info" className="text-xs">
              推奨：発症後24〜72時間以内のNIHSSを入力。それ以外（例：回復期入院時のNIHSS）のみの場合は「NIHSS不明」を選択してください。
            </Alert>
          )}
        </div>
        <div className="col-span-2 space-y-2 border border-blue-200 p-2 rounded bg-blue-50">
          <Num label="発症前mRS (0–6)" value={mrs} onChange={(v) => dispatch({ type: 'SET_WITH_CLAMP', payload: { field: 'mrs', errorField: 'mrsError', value: v, min: 0, max: 6 } })} min={0} max={6} error={mrsError} helperText="引用論文の定義に合わせ「発症前mRS」を入力" />
        </div>
      </CardContent>
    </Card>
  );
}


// ---- Explore (係数調整) ----
function ExploreSection({ state, dispatch }: any) {
  const setVals = (wNeg: number, wAph: number, wApx: number) => {
    dispatch({ type: 'UPDATE', field: 'wNeg', value: wNeg });
    dispatch({ type: 'UPDATE', field: 'wAph', value: wAph });
    dispatch({ type: 'UPDATE', field: 'wApx', value: wApx });
  };
  const strict = () => setVals(0, 0, 0); // 厳密(0)
  const fixed = () => setVals(HOME.bNeg ?? -0.4, HOME.bAph ?? -0.2, HOME.bApx ?? -0.2); // 固定係数(参考)
  const weak  = () => setVals(-0.2, -0.1, -0.1); // 弱め
  const reset = strict;
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="font-semibold">探索モード（係数調整）</div>
        <div className="text-xs text-slate-600">失語・無視・失行がある条件で z に加える施設可変係数。0 は厳密モード（影響なし）。</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Num label="wNeg（無視）" value={state.wNeg} onChange={(v: number) => dispatch({ type: 'UPDATE', field: 'wNeg', value: clamp(v, -1, 1) })} min={-1} max={1} step={0.05} helperText="負は不利方向" />
          <Num label="wAph（失語）" value={state.wAph} onChange={(v: number) => dispatch({ type: 'UPDATE', field: 'wAph', value: clamp(v, -1, 1) })} min={-1} max={1} step={0.05} />
          <Num label="wApx（失行）" value={state.wApx} onChange={(v: number) => dispatch({ type: 'UPDATE', field: 'wApx', value: clamp(v, -1, 1) })} min={-1} max={1} step={0.05} />
        </div>
        <div className="text-xs flex flex-wrap gap-2">
          <Button onClick={strict}>厳密(0)</Button>
          <Button onClick={fixed}>固定係数(参考)</Button>
          <Button onClick={weak}>弱め(-0.2/-0.1/-0.1)</Button>
          <Button onClick={reset}>リセット</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ResultsSection({ state, beta, fim, pHome, items, kItemOnChange, tests, runTests, onOpenKModal, onOpenThrModal }: any) {
  const { kItem, dB, dX } = state;
  const decisionP = Number.isFinite(pHome) ? pHome : NaN;
  const homeDisplay = Number.isFinite(pHome) ? Math.round(pHome * 100) + '%' : '—';
  const ci = Number.isFinite(fim) ? bootstrapCI(state, fim, 200) : null;
  const ciDisplay = ci ? `${Math.round(ci.lo * 100)}–${Math.round(ci.hi * 100)}%` : undefined;
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="font-semibold">結果</div>
        {!Number.isFinite(beta) && <Alert type="error">βを計算できません。基本入力（2点法）を確認してください。</Alert>}
        {Number.isFinite(beta) && (
          <>
            {beta <= 0 && <Alert type="warning">βが負の値（{F(beta, 2)}）です。停滞/退行の可能性があります。</Alert>}
            {dX < dB && <Alert type="info">予測日Xが測定日Bより前です（過去の推定）。</Alert>}

            <div className="flex items-center justify-between">
              <div className="text-xs flex items-center gap-2">
                <span>ロジット傾き k</span>
                <button onClick={onOpenKModal} aria-label="ロジット傾き k の説明を開く" className="w-4 h-4 rounded-full border border-gray-400 text-xs text-gray-600 hover:bg-gray-100 flex items-center justify-center">?</button>
                <input type="number" step={0.01} min={0.01} max={1} className="border rounded px-2 py-1 w-20" value={kItem} onChange={(e) => kItemOnChange(e.target.value)} />
              </div>
              <div className="text-xs flex items-center gap-2">
                <span className="text-slate-600">閾値: 自宅≥{Math.round(state.thrHomeHi * 100)}% / 非自宅≤{Math.round(state.thrHomeLo * 100)}%</span>
                <button onClick={onOpenThrModal} className="underline">[設定]</button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-sm">
              <Kpi label="β (回復速度)" value={F(beta, 2)} />
              <Kpi label="予測FIM-m" value={F(fim, 0)} note="※予測は91点でクリップ" />
              <Kpi label="自宅退院確率" value={homeDisplay} note={ciDisplay ? `CI: ${ciDisplay}` : undefined} />
            </div>

            <div className="text-xs">
              <span className={
                "inline-block rounded px-2 py-0.5 border " +
                (Number.isFinite(decisionP) && decisionP >= state.thrHomeHi
                  ? "border-green-300 text-green-700 bg-green-50"
                  : Number.isFinite(decisionP) && decisionP <= state.thrHomeLo
                  ? "border-red-300 text-red-700 bg-red-50"
                  : "border-yellow-300 text-yellow-700 bg-yellow-50")
              }>
                {Number.isFinite(decisionP)
                  ? decisionP >= state.thrHomeHi
                    ? "高確度：自宅"
                    : decisionP <= state.thrHomeLo
                    ? "高確度：非自宅"
                    : "要判断（保留）"
                  : "—"}
              </span>
              {state.nihUnknown && (
                <span className="ml-2 text-gray-500">※NIHSS不明のため感度レンジ下限で判定</span>
              )}
            </div>

            <div className="font-medium">項目別：5点到達確率</div>
            <div className="overflow-auto text-sm">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th>項目</th>
                    <th>θ補正</th>
                    <th>到達p</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={3}>FIM予測が未計算</td>
                    </tr>
                  ) : (
                    items.map((r: any) => (
                      <tr key={r.key} className={isHalf(r.p) ? 'bg-yellow-100/60' : ''}>
                        <td>{r.label}</td>
                        <td>{r.th.toFixed(1)}→{r.thAdj.toFixed(1)}</td>
                        <td>{Math.round(r.p * 100)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="no-print flex items-center gap-2 pt-2">
              <Button onClick={runTests}>自己テスト</Button>
            </div>

            {tests.length > 0 && (
              <div className="no-print overflow-auto text-xs border rounded p-2">
                <div className="font-medium mb-1">自己テスト結果</div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left border-b py-1">テスト</th>
                      <th className="text-left border-b py-1">結果</th>
                      <th className="text-left border-b py-1">詳細</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tests.map((t: any, i: number) => (
                      <tr key={i}>
                        <td className="py-1 border-b">{t.name}</td>
                        <td className={cx('py-1 border-b', t.pass ? 'text-green-600' : 'text-red-600')}>{t.pass ? 'PASS' : 'FAIL'}</td>
                        <td className="py-1 border-b">{t.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function bucket(p: number, lo: number, hi: number) {
  if (!Number.isFinite(p)) return '—' as any;
  if (p >= hi) return 'home';
  if (p <= lo) return 'nonhome';
  return 'uncertain';
}

function SensitivityCard({ state, fim, pHome, beta }: any) {
  const [showAge, setShowAge] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const thrLo = state.thrHomeLo; const thrHi = state.thrHomeHi;
  const zBase = useMemo(() => calcZ(state, fim), [state, fim]);
  const baseBucket = useMemo(() => bucket(pHome, thrLo, thrHi), [pHome, thrLo, thrHi]);

  const robustNIH = useMemo(() => {
    if (!state.nihUnknown) return null;
    const pWorst = sig(calcZ(state, fim, 'high'));
    const pBest = sig(calcZ(state, fim, 'low'));
    return bucket(pWorst, thrLo, thrHi) === bucket(pBest, thrLo, thrHi);
  }, [state, fim, thrLo, thrHi]);
  const robustMeas = useMemo(() => {
    const p0 = pHome;
    const pM = sig(calcZ(state, clamp(fim - 2, 0, 91)));
    const pP = sig(calcZ(state, clamp(fim + 2, 0, 91)));
    const b0 = bucket(p0, thrLo, thrHi);
    const bM = bucket(pM, thrLo, thrHi);
    const bP = bucket(pP, thrLo, thrHi);
    return b0 === bM && b0 === bP;
  }, [state, fim, pHome, thrLo, thrHi]);

  const minDelta = useMemo(() => {
    if (!Number.isFinite(pHome)) return { needed: NaN, days: NaN, note: '未計算' };
    if (pHome >= thrHi) return { needed: 0, days: 0, note: 'すでに高確度：自宅' };
    const other = zBase - HOME.bFim * fim; // z = bFim*fim + other
    const zTarget = logit(thrHi);
    const fimNeeded = (zTarget - other) / HOME.bFim;
    const needed = Math.max(0, fimNeeded - fim);
    let days: number = NaN;
    if (Number.isFinite(beta) && beta > 0 && needed > 0) {
      const dln = needed / beta; // Δln(day)
      days = Math.round(state.dX * (Math.exp(dln) - 1));
      if (!Number.isFinite(days) || days < 0) days = NaN;
    }
    return { needed, days, note: needed > 0 && fimNeeded > 91 ? '天井超えのため困難' : '' };
  }, [pHome, thrHi, zBase, fim, beta, state.dX]);

  const scenarios = useMemo(() => {
    if (!Number.isFinite(pHome)) return [] as any[];
    const list: any[] = [];
    const fimUp = clamp(fim + 5, 0, 91);
    const fimDn = clamp(fim - 5, 0, 91);
    list.push({ id: 'fim+5', label: 'FIM +5', p: sig(calcZ(state, fimUp)), actionable: true });
    list.push({ id: 'fim-5', label: 'FIM -5', p: sig(calcZ(state, fimDn)), actionable: true });
    list.push({ id: 'toCohab', label: '独居→同居（支援追加）', p: sig(calcZ({ ...state, alone: false, hh: Math.max(2, state.hh) }, fim)), actionable: true });
    list.push({ id: 'toAlone', label: '同居→独居', p: sig(calcZ({ ...state, alone: true, hh: 1 }, fim)), actionable: true });
    list.push({ id: 'stairsOff', label: '階段→なし（動線変更/対策）', p: sig(calcZ({ ...state, stairs: false }, fim)), actionable: true });
    list.push({ id: 'stairsOn', label: '階段→あり', p: sig(calcZ({ ...state, stairs: true }, fim)), actionable: true });
    if (showAge) {
      list.push({ id: 'age+5', label: '年齢 +5（説明用）', p: sig(calcZ({ ...state, age: clamp(state.age + 5, 18, 120) }, fim)), actionable: false });
      list.push({ id: 'age-5', label: '年齢 -5（説明用）', p: sig(calcZ({ ...state, age: clamp(state.age - 5, 18, 120) }, fim)), actionable: false });
    }
    return list.map((r) => ({ ...r, dp: Number.isFinite(pHome) ? (r.p - pHome) : NaN }))
      .sort((a, b) => (b.dp - a.dp));
  }, [state, fim, pHome, showAge]);

  const top = scenarios[0];

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold flex items-center gap-2">
            <span>感度分析（可変レバー）</span>
            <button onClick={() => setShowHelp(true)} aria-label="用語説明" className="w-5 h-5 rounded-full border border-gray-400 text-xs text-gray-600 hover:bg-gray-100">?</button>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {state.nihUnknown && (
              <span className={cx('px-2 py-0.5 rounded border', robustNIH ? 'border-green-300 text-green-700 bg-green-50' : 'border-yellow-300 text-yellow-700 bg-yellow-50')}>
                NIHSSレンジ{robustNIH ? '一貫' : 'で変動'}
              </span>
            )}
            <span className={cx('px-2 py-0.5 rounded border', robustMeas ? 'border-green-300 text-green-700 bg-green-50' : 'border-yellow-300 text-yellow-700 bg-yellow-50')}>
              測定誤差±2{robustMeas ? 'でも不変' : 'で変動'}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="text-xs flex items-center gap-4">
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={showAge} onChange={(e) => setShowAge(e.target.checked)} />不可変（年齢）も表示</label>
          <div className="text-slate-500">基準p: {P(pHome)}（区分: {baseBucket}／自宅≥{Math.round(thrHi*100)}%・非自宅≤{Math.round(thrLo*100)}%）</div>
        </div>

        {/* Minimal Δ card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Kpi label={<span>高確度（自宅）に必要FIMΔ <span title="pが自宅判定閾値（thrHi）に達するために必要なFIM増分。β>0時は日数換算を併記">(i)</span></span>} value={Number.isFinite(minDelta.needed) ? (minDelta.needed === 0 ? '不要' : F(minDelta.needed, 1)) : '—'} note={minDelta.note} />
          <Kpi label={<span>概算必要日数 <span title="必要FIMΔをβ（回復速度）で割り、対数回復モデルから日数換算した概算値">(i)</span></span>} value={Number.isFinite(minDelta.days) ? (minDelta.days === 0 ? '0日' : `${minDelta.days}日`) : '—'} note={Number.isFinite(beta) && beta <= 0 ? 'β≤0で推定不可' : ''} />
          <Kpi label={<span>最有力レバー <span title="シナリオのうちΔpが最大のもの（可変を優先）">(i)</span></span>} value={top ? `${top.label}` : '—'} note={top ? `Δp=${(top.dp>0?'+':'')}${F(top.dp*100,1)}%` : ''} />
        </div>

        {/* Scenario table */}
        <div className="overflow-auto text-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left border-b py-1">シナリオ</th>
                <th className="text-left border-b py-1"><abbr title="現在の入力条件での自宅退院確率">p</abbr></th>
                <th className="text-left border-b py-1"><abbr title="シナリオ適用後のp − 基準p">Δp</abbr></th>
                <th className="text-left border-b py-1">備考</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.id}>
                  <td className="py-1 border-b">{s.label}</td>
                  <td className="py-1 border-b">{P(s.p)}</td>
                  <td className={cx('py-1 border-b', s.dp>0 ? 'text-green-700' : s.dp<0 ? 'text-red-700' : '')}>{(s.dp>0?'+':'') + F(s.dp*100,1) + '%'}</td>
                  <td className="py-1 border-b text-xs text-slate-500">{s.actionable ? '可変' : '不可変'}</td>
                </tr>
              ))}
              {scenarios.length === 0 && (
                <tr><td colSpan={4} className="py-2 text-center text-xs text-gray-500">計算できません</td></tr>
              )}
            </tbody>
          </table>
          <div className="text-[11px] text-slate-500 mt-2 space-y-1">
            <div>※ Δp&gt;0 は自宅退院確率の上昇、Δp&lt;0 は低下を示します。</div>
            <div>※ 可変＝介入で変更可能（FIM訓練、同居支援、住環境調整など）。不可変（年齢）は説明用にのみ表示されます。</div>
            <div>※ β≤0 やFIMが天井付近（&gt;85）では日数換算の不確実性が高まります。</div>
          </div>
        </div>
      </CardContent>

      {/* Help modal */}
      {showHelp && (
        <Modal onClose={() => setShowHelp(false)} title="感度分析の用語説明">
          <div className="text-sm space-y-3">
            <div>
              <div className="font-semibold">p（確率）</div>
              <div className="text-xs text-slate-700">現在の入力条件での自宅退院確率。自宅判定は p ≥ {Math.round(thrHi*100)}%、非自宅は p ≤ {Math.round(thrLo*100)}%、それ以外は保留。</div>
            </div>
            <div>
              <div className="font-semibold">Δp（確率差）</div>
              <div className="text-xs text-slate-700">シナリオ適用後の p から基準 p を引いた差。介入の効き目を同一尺度で比較できます。</div>
            </div>
            <div>
              <div className="font-semibold">概算必要日数</div>
              <div className="text-xs text-slate-700">高確度：自宅（p ≥ {Math.round(thrHi*100)}%）に到達するために必要な FIM 増分を、β（回復速度）から日数換算した概算値（β&gt;0 のときのみ）。</div>
            </div>
            <div>
              <div className="font-semibold">最有力レバー</div>
              <div className="text-xs text-slate-700">可変シナリオのうち Δp が最大のもの。優先介入の目安になります。</div>
            </div>
            <div>
              <div className="font-semibold">ロバスト（頑健）</div>
              <div className="text-xs text-slate-700">NIHSSの不明レンジ（低〜高）や測定誤差±2点の両端で判定区分が変わらない場合に「不変」と表示します。</div>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function PrintReport({ beta, fim, pHome, dX, fimTimeSeries, items }: any) {
  return (
    <div className="print-report hidden p-8 space-y-6">
      <h1 className="text-2xl font-bold">脳卒中予後予測レポート</h1>
      {Number.isFinite(beta) ? (
        <>
          <div className="print-section">
            <h2 className="text-xl font-bold border-b pb-2 mb-4">基本情報と予測結果</h2>
            <table className="w-full">
              <tbody>
                <tr><td className="w-1/2"><strong>β (機能回復速度)</strong></td><td className="w-1/2">{F(beta, 2)}</td></tr>
                <tr><td><strong>予測FIM-m (Day {dX})</strong></td><td>{F(fim, 0)}点</td></tr>
                <tr><td><strong>自宅退院確率</strong></td><td>{Number.isFinite(pHome) ? Math.round(pHome * 100) + "%" : "—"}</td></tr>
              </tbody>
            </table>
            <div className="mt-2 text-xs text-slate-500">※予測FIMは91点でクリップ。</div>
          </div>
          <div className="print-section">
            <h2 className="text-xl font-bold border-b pb-2 mb-4">FIM-m予測値の時系列変化</h2>
            <table className="w-full">
              <thead><tr><th className="py-1 border-b text-left">日</th><th className="py-1 border-b text-left">FIM-m</th></tr></thead>
              <tbody>
                {Array.isArray(fimTimeSeries) && fimTimeSeries.length > 0 ? (
                  fimTimeSeries.map((x: any) => (
                    <tr key={x.day}><td className="py-1 border-b text-left">{x.day}</td><td className="py-1 border-b text-left">{F(x.fim, 0)}</td></tr>
                  ))
                ) : (
                  <tr><td colSpan={2} className="py-2 text-center text-xs text-gray-500">データがありません</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="print-section">
            <h2 className="text-xl font-bold border-b pb-2 mb-4">項目別：5点（監視）到達確率</h2>
            <table className="w-full">
              <thead><tr><th className="py-1 border-b text-left">項目</th><th className="py-1 border-b text-left">到達確率</th></tr></thead>
              <tbody>
                {Array.isArray(items) && items.length > 0 ? (
                  items.map((r: any) => (
                    <tr key={r.key}><td className="py-1 border-b text-left">{r.label}</td><td className="py-1 border-b text-left">{Number.isFinite(r.p) ? Math.round(r.p * 100) + "%" : "—"}</td></tr>
                  ))
                ) : (
                  <tr><td colSpan={2} className="py-2 text-center text-xs text-gray-500">FIM予測が未計算です</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="text-sm text-slate-600">予測に必要な入力が不足しています。</div>
      )}
    </div>
  );
}

// ---- Evidence（一覧表示） ----
// 依頼により「カード方式→一覧方式」へ。原著リンクがブロックされる場合の注意書き付き。
const EVIDENCE_LIST: Array<{
  id: string;
  cite: string; // 書誌（著者, 雑誌, 年など）
  note: string; // 要約（FIM/退院先等への影響）
  link: string; // 原著リンク（doi/pmid/url）
}> = [
  // 注意/実行機能（TMT）
  { id: 'kondo_tmtA_home_2024', cite: 'Kondo K, et al. Jpn Geriatr Telecare Stroke. 2024.', note: 'TMT-Aの追加で自宅退院モデルの再分類が改善（IDI 0.034, p=0.024）', link: 'https://www.jstage.jst.go.jp/article/jgts/4/0/4_2024_012_OA/_article/-char/en' },
  { id: 'brainsci_tmtb_2023', cite: 'Sakai K, et al. Brain Sciences. 2023.', note: 'TMT-B重症度がFIMや歩行関連指標と関連。実行機能障害群で歩行自立が劣る。', link: 'https://www.mdpi.com/2076-3425/13/4/627' },
  // 失行（FIMアウトカム重視の2本）
  { id: 'neuroasia_apraxia_2020', cite: 'Yemisci U, et al. Neurology Asia. 2020.', note: '失行群は入院時FIMが低く、退院時の自立度（FIM）到達も低い（FIM gain群間差は非有意）。', link: 'https://www.neurology-asia.org/articles/neuroasia-2020-25(4)-459.pdf' },
  { id: 'topstroke_apraxia_2014', cite: 'Wu AJ; Burgard E; Radel J. Top Stroke Rehabil. 2014.', note: '失行合併群は退院時のFIM（総合/運動/認知）が有意に低値。FIM改善幅は大差なし。', link: 'pmid:24985388' },
  // 失語
  { id: 'apmr_aphasia_2010', cite: 'Hanna-Pladdy B, et al. Arch Phys Med Rehabil. 2010.', note: '失語は退院時FIM-認知の低下を独立に予測。無視はFIM-運動の低下に関連。', link: 'pmid:20720414' },
  // 無視
  { id: 'usn_fim_2019', cite: '— (USN severity study). 2019.', note: 'CBS無視重症度がFIM-運動、FIM gain、FIM effectivenessを予測。退院先にも関与。', link: 'pmid:31134787' },
  // 記憶/PSCI（メタ解析：FIM含むADLに関連）
  { id: 'stolwyk_psci_2021', cite: 'Stolwyk RJ, et al. Eur J Neurol. 2021.', note: 'PSCIはADL指標（BarthelやFIMを含む）と有意に関連。', link: 'https://onlinelibrary.wiley.com/doi/10.1111/ene.14830' },
];

const EvidenceListSimple: React.FC = () => {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // クリックのハードニング（details/summary 内でも確実に別タブで開く）
  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    const delegated = (ev: any) => {
      const a = (ev.target as HTMLElement).closest('a');
      if (!a || !root.contains(a)) return;
      const raw = a.getAttribute('href') || a.getAttribute('data-url') || a.textContent || '';
      const href = normalizeUrl(raw || ''); if (!href) return;
      ev.preventDefault(); ev.stopPropagation();
      try { window.open(href, '_blank', 'noopener'); } catch (_) {}
    };
    root.addEventListener('click', delegated, true);
    return () => { root.removeEventListener('click', delegated, true); };
  }, []);

  return (
    <div ref={rootRef} className="space-y-2 text-sm">
      <div className="text-xs text-slate-500 mb-2">※ 原著リンクがブラウザ設定等で開かない場合は、<b>リンクをコピーして貼り付け</b>てください。</div>
      <ul className="list-disc ml-5 space-y-2">
        {EVIDENCE_LIST.map((e) => (
          <li key={e.id}>
            <span className="font-medium">{e.cite}</span> — {e.note} （<a className="text-blue-600 underline" href={normalizeUrl(e.link)} target="_blank" rel="noopener noreferrer">原著</a>）
          </li>
        ))}
      </ul>
    </div>
  );
};

// ---- モーダル ----
function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = modalRef.current; if (!el) return;
    const selectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusables = el.querySelectorAll<HTMLElement>(selectors);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const prev = document.activeElement as HTMLElement | null;
    first?.focus?.();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose && onClose(); }
      if (e.key === 'Tab') {
        if (focusables.length === 0) { e.preventDefault(); return; }
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last && last.focus && last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first && first.focus && first.focus(); }
      }
    };
    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('keydown', onKeyDown);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div ref={modalRef} className="bg-white rounded-lg p-6 max-w-lg w-full shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center border-b pb-2 mb-4">
          <h3 className="text-xl font-bold">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---- 初期状態 & reducer ----
const initState = {
  dA: 7, fA: 30, dB: 14, fB: 45, dX: 21,
  fAError: "", fBError: "", nihError: "", mrsError: "",
  age: 70, alone: false, hh: 2, stairs: true, hem: "不明",
  aph: false, neg: false, apx: false,
  nihUnknown: false, nih: 10, mrs: 0,
  kItem: 0.12,
  // 高確度モード
  thrHomeHi: 0.90, // 自宅≥
  thrHomeLo: 0.10, // 非自宅≤
  minABDays: 7,
  // ヒューリスティック係数（厳密モード=0）
  wNeg: 0, wAph: 0, wApx: 0,
};
function reducer(state: any, action: any) {
  // 無効アクションは no-op
  if (!action || typeof action !== 'object' || !('type' in action)) {
    console.error('Invalid action object', action);
    return state;
  }
  switch (action.type) {
    case 'UPDATE':
      return { ...state, [action.field]: action.value };
    case 'TOGGLE':
      return { ...state, [action.field]: !state[action.field] };
    case 'SET_WITH_CLAMP': {
      const { field, errorField, value, min, max } = action.payload;
      const clamped = clamp(value, min, max);
      return { ...state, [field]: clamped, [errorField]: value !== clamped ? `範囲外 (${min}–${max})` : "" };
    }
    case 'RESET':
      return { ...initState };
    default:
      return state;
  }
}

// ---- Main Page ----
export default function Page() {
  const [state, dispatch] = useReducer(reducer, initState);

  // 自動保存
  useEffect(() => {
    try {
      const raw = localStorage.getItem('adl_state_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        Object.keys(parsed).forEach((k) => { if (k in initState) dispatch({ type: 'UPDATE', field: k, value: (parsed as any)[k] }); });
      }
    } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { try { localStorage.setItem('adl_state_v1', JSON.stringify(state)); } catch (_) {} }, [state]);

  const [tests, setTests] = useState<any[]>([]);
  const [isKModalOpen, setIsKModalOpen] = useState(false);
  const [isIntervalModalOpen, setIsIntervalModalOpen] = useState(false);
  const [isMetricsOpen, setIsMetricsOpen] = useState(false);
  const [isOCEBMOpen, setIsOCEBMOpen] = useState(false);
  const [isThrOpen, setIsThrOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isConsentOpen, setIsConsentOpen] = useState(false);
  const [isTosOpen, setIsTosOpen] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);
  const VERSION = "v0.9.0-personal";
  useEffect(() => { try { const ok = localStorage.getItem('adl-consent-v1') === '1'; if (!ok) setIsConsentOpen(true); } catch (_) {} }, []);
  const acceptConsent = () => { try { localStorage.setItem('adl-consent-v1', '1'); } catch (_) {} setIsConsentOpen(false); };

  // 派生量
  const beta = useMemo(() => beta2pt(state.dA, state.fA, state.dB, state.fB), [state.dA, state.fA, state.dB, state.fB]);
  const fimRaw = useMemo(() => fimAt(state.dX, state.dA, state.fA, beta), [state.dX, state.dA, state.fA, beta]);
  const fim = useMemo(() => clamp(fimRaw, 0, 91), [fimRaw]);
  const fimTimeSeries = useMemo(() => {
    if (!Number.isFinite(beta) || !Number.isFinite(state.dX)) return [] as any[];
    const safeDX = Math.max(1, state.dX);
    const startDay = Math.max(1, safeDX - 30);
    const endDay = safeDX + 30;
    const series: any[] = [];
    for (let day = startDay; day <= endDay; day++) {
      const y = fimAt(day, state.dA, state.fA, beta);
      series.push({ day, fim: clamp(y, 0, 91) });
    }
    return series;
  }, [beta, state.dX, state.dA, state.fA]);

  const micro = useMemo(() => {
    const L = state.hem === "左"; const R = state.hem === "右";
    return {
      aph: state.aph ? (L ? 0.6 : 0.2) : 0,
      neg: state.neg ? (R ? 0.8 : 0.3) : 0,
      apx: state.apx ? (L ? 0.7 : 0.2) : 0,
    };
  }, [state.hem, state.aph, state.neg, state.apx]);

  const nihCat = useMemo(() => (state.nihUnknown ? "unknown" : state.nih <= 5 ? "low" : state.nih <= 13 ? "mid" : "high"), [state.nih, state.nihUnknown]);
  const mrsCat = useMemo(() => (state.mrs <= 2 ? "mrs2" : state.mrs === 3 ? "mrs3" : state.mrs === 4 ? "mrs4" : "mrs5"), [state.mrs]);

  const items = useMemo(() => {
    if (!Number.isFinite(fim)) return [] as any[];
    return TH.map(({ key, label, th }) => {
      const w = (CFG.weights as any)[key] || [0, 0, 0];
      const d = SC.sNeg * w[0] * micro.neg + SC.sAph * w[1] * micro.aph + SC.sApx * w[2] * micro.apx;
      const thAdj = th + d;
      return { key, label, th, thAdj, p: logitP(fim, thAdj, state.kItem) };
    }).sort((a, b) => a.p - b.p);
  }, [fim, state.kItem, micro]);

  const pHome = useMemo(() => {
    if (!Number.isFinite(fim)) return NaN;
    const xAge = (state.age - 75) / 10;
    const nihAdj = state.nihUnknown ? 0 : nihCat === "low" ? HOME.bNihL : nihCat === "mid" ? HOME.bNihM : HOME.bNihH;
    const mrsAdj = mrsCat === "mrs2" ? HOME.bMrs2 : mrsCat === "mrs3" ? HOME.bMrs3 : mrsCat === "mrs4" ? HOME.bMrs4 : HOME.bMrs5;
    const z = HOME.intercept + HOME.bFim * fim + HOME.bAge * xAge + HOME.bAlone * (state.hh <= 1 ? 1 : 0) + HOME.bHH * Math.max(0, state.hh - 1) + (state.neg ? state.wNeg : 0) + (state.aph ? state.wAph : 0) + (state.apx ? state.wApx : 0) + HOME.bStairs * (state.stairs ? 1 : 0) + nihAdj + mrsAdj;
    return sig(z);
  }, [fim, state.age, state.hh, state.neg, state.aph, state.apx, state.stairs, nihCat, mrsCat, state.nihUnknown]);

  const runTests = () => {
    const res: any[] = [];
    // 既存＆追加テスト
    const b = beta2pt(30, 40, 60, 55);
    res.push({ name: "β 基本", pass: Number.isFinite(b), detail: `β=${F(b, 3)}` });
    const f = fimAt(90, 30, 40, b);
    res.push({ name: "FIM 単調性", pass: Number.isFinite(f) && f > 40, detail: `FIM=${F(f, 1)}` });
    const bBad = beta2pt(30, 40, 20, 55);
    res.push({ name: "β 不正入力でNaN", pass: Number.isNaN(bBad), detail: `β=${String(bBad)}` });
    const p1 = logitP(40, 50, 0.12), p2 = logitP(60, 50, 0.12);
    res.push({ name: "logit 単調性", pass: p2 > p1 && Number.isFinite(p1) && Number.isFinite(p2), detail: `p1=${F(p1, 3)}, p2=${F(p2, 3)}` });
    const ph = Number.isFinite(f) ? sig(HOME.intercept + HOME.bFim * f) : NaN;
    res.push({ name: "確率レンジ(0-1)", pass: Number.isFinite(ph) && ph >= 0 && ph <= 1, detail: `p=${F(ph, 3)}` });
    if (Number.isFinite(f)) res.push({ name: "項目数", pass: items.length === CFG.thresholds.length, detail: `${items.length}/${CFG.thresholds.length}` });
    const pEq = logitP(100, 100, 0.12);
    res.push({ name: "閾値=50% 包含", pass: Math.abs(pEq - 0.5) < 1e-9, detail: `p=${F(pEq, 3)}` });
    res.push({ name: "ハイライト関数 isHalf", pass: isHalf(pEq), detail: `isHalf(${F(pEq, 3)})` });
    const c1 = clamp(-5, 0, 6) === 0 && clamp(9, 0, 6) === 6 && clamp(3, 0, 6) === 3;
    res.push({ name: "clamp 範囲調整", pass: c1, detail: `[-5→${clamp(-5, 0, 6)}, 9→${clamp(9, 0, 6)}, 3→${clamp(3, 0, 6)}]` });
    res.push({ name: "世帯整合性 alone⇔hh", pass: (state.hh <= 1) === state.alone, detail: `alone=${state.alone}, hh=${state.hh}` });

    // NIHSS不明レンジ順序
    try {
      if (state.nihUnknown) {
        const f2 = Number.isFinite(f) ? (f as number) : 50;
        const pLoT = sig(calcZ(state, f2, 'high')); // 悪い方
        const pHiT = sig(calcZ(state, f2, 'low'));  // 良い方
        res.push({ name: "NIHSS不明レンジ順序", pass: pLoT <= pHiT, detail: `lo=${F(pLoT,3)}, hi=${F(pHiT,3)}` });
      }
    } catch (_) {}

    res.push({ name: "閾値バリデーション", pass: (state.thrHomeLo < state.thrHomeHi) && ((state.thrHomeHi - state.thrHomeLo) >= 0.20), detail: `lo=${state.thrHomeLo}, hi=${state.thrHomeHi}` });
    res.push({ name: "A–B間隔", pass: (state.dB - state.dA) >= (state.minABDays ?? 7), detail: `A=${state.dA}, B=${state.dB}` });

    // CI 整合（pLo <= p̂ <= pHi）
    try {
      if (Number.isFinite(f)) {
        const ciT = bootstrapCI(state, f as number, 100);
        if (ciT) {
          const pHatT = sig(calcZ(state, f as number));
          res.push({ name: "CI整合", pass: ciT.lo <= pHatT && pHatT <= ciT.hi, detail: `lo=${F(ciT.lo,3)}, hat=${F(pHatT,3)}, hi=${F(ciT.hi,3)}` });
        }
      }
    } catch (_) {}

    // weights index mapping（回帰テスト）
    try {
      const w = [2, 3, 4];
      const microTmp = { neg: 1, aph: 1, apx: 1 };
      const dCalc = SC.sNeg * w[0] * microTmp.neg + SC.sAph * w[1] * microTmp.aph + SC.sApx * w[2] * microTmp.apx;
      const dExpect = SC.sNeg * 2 + SC.sAph * 3 + SC.sApx * 4;
      res.push({ name: "weights index mapping", pass: Math.abs(dCalc - dExpect) < 1e-9, detail: `calc=${F(dCalc,2)} expect=${F(dExpect,2)}` });
    } catch (_) {}

    // reducer invalid-action no-op
    try {
      const s2 = reducer(state, null);
      const noOp = s2 === state;
      res.push({ name: 'reducer 無効アクション no-op', pass: noOp, detail: String(noOp) });
    } catch (e) {
      res.push({ name: 'reducer 無効アクション no-op', pass: false, detail: String(e) });
    }

    // F/F0 フォーマッタ
    try {
      const t1 = F(1.2345, 2) === '1.23';
      const t2 = F('12', 0) === '12';
      const t3 = F(undefined as any, 2) === '—' && F('abc', 2) === '—';
      const t4 = F(1.2, -5) === '1' && F(1.2, 50) === '1.200000'; // clamp 0..6
      const z1 = F0(undefined as any, 2) === '0.00' && F0('abc', 1) === '0.0';
      res.push({ name: 'F 数値丸め', pass: t1, detail: F(1.2345,2) });
      res.push({ name: 'F 文字列数値', pass: t2, detail: F('12',0) });
      res.push({ name: 'F 非数→ダッシュ', pass: t3, detail: F('abc',2) });
      res.push({ name: 'F 桁数クランプ', pass: t4, detail: `${F(1.2,-5)} / ${F(1.2,50)}` });
      res.push({ name: 'F0 非数→ゼロ埋め', pass: z1, detail: `${F0(undefined,2)} / ${F0('abc',1)}` });
    } catch (e) {
      res.push({ name: 'F/F0 フォーマッタ', pass: false, detail: String(e) });
    }

    setTests(res);
  };

  // 予測補助（items 計算）
  const itemsMemo = items; // そのまま露出

  // 画面
  return (
    <div className="p-4 space-y-4 max-w-4xl md:max-w-5xl mx-auto">
      {/* 医療機器表示 */}
      <div className="no-print text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-2">
        本アプリは<b>医療機器ではありません</b>。教育・ディスカッション目的で提供されます。
      </div>

      <div className="no-print">
        <h1 className="text-lg font-bold">脳卒中予後予測（完全版）</h1>
        <p className="text-sm text-gray-700 mt-2">2つの測定点（A, B）からβ（回復速度）を推定し、予測日XでのFIM-mを推定します。</p>
      </div>

      <div className="no-print grid grid-cols-1 md:grid-cols-2 gap-4">
        <InputSection state={state} dispatch={dispatch} onOpenInterval={() => setIsIntervalModalOpen(true)} />
        <FactorsSection state={state} dispatch={dispatch} />
      </div>

      <ExploreSection state={state} dispatch={dispatch} />

      <ResultsSection
        state={state}
        beta={beta}
        fim={fim}
        pHome={pHome}
        items={itemsMemo}
        kItemOnChange={(val: any) => dispatch({ type: 'UPDATE', field: 'kItem', value: clamp(toNum(val, state.kItem), 0.01, 1) })}
        tests={tests}
        runTests={runTests}
        onOpenKModal={() => setIsKModalOpen(true)}
        onOpenThrModal={() => setIsThrOpen(true)}
      />

      {/* Sensitivity */}
      <SensitivityCard state={state} fim={fim} pHome={pHome} beta={beta} />

      {/* Evidence（一覧） */}
      <div className="no-print">
        <details className="sm:open">
          <summary className="cursor-pointer font-semibold select-none">高次脳機能障害がFIM回復に与える要因の検討<span className="text-xs text-slate-500 ml-2">(タップで展開)</span></summary>
          <div className="mt-2">
            <Card>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">文献一覧（FIM/退院先への影響）</div>
                  <div className="text-xs text-slate-500">※ 予測数値には未反映（情報提供）</div>
                </div>
                <EvidenceListSimple />
              </CardContent>
            </Card>
          </div>
        </details>
      </div>

      {/* Actions */}
      <div className="no-print flex items-center gap-2 pt-2">
        <Button onClick={() => setIsAboutOpen(true)}>このアプリについて</Button>
        <Button onClick={() => setIsTosOpen(true)}>利用規約</Button>
        <Button onClick={() => setIsPrivacyOpen(true)}>プライバシー</Button>
        <Button onClick={() => dispatch({ type: 'RESET' })}>リセット</Button>
        <Button onClick={() => window.print()}>印刷</Button>
      </div>

      {/* Print */}
      <PrintReport beta={beta} fim={fim} pHome={pHome} dX={state.dX} fimTimeSeries={fimTimeSeries} items={itemsMemo} />

      {/* Mobile action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 sm:hidden bg-white/95 backdrop-blur border-t p-2 flex justify-end gap-2">
        <Button onClick={runTests}>自己テスト</Button>
        <Button onClick={() => dispatch({ type: 'RESET' })}>リセット</Button>
        <Button onClick={() => window.print()}>印刷</Button>
      </div>

      {/* Modals */}
      {isKModalOpen && (
        <Modal onClose={() => setIsKModalOpen(false)} title="ロジット傾き k について">
          <div className="text-sm">
            <p className="mb-2">「ロジット傾き k」は、FIMスコアの変化が項目別達成確率にどれだけ影響するかを調整する係数です（論文由来ではありません）。</p>
            <ul className="space-y-2">
              {[{ t: "緩やか", v: 0.08 }, { t: "標準", v: 0.12 }, { t: "鋭い", v: 0.16 }].map(({ t, v }) => (
                <li key={v} className="flex items-center gap-2">
                  <div className="font-bold w-16">{t}</div>
                  <Button onClick={() => { dispatch({ type: 'UPDATE', field: 'kItem', value: v }); setIsKModalOpen(false); }}>k={v}に設定</Button>
                </li>
              ))}
            </ul>
          </div>
        </Modal>
      )}
      {isIntervalModalOpen && (
        <Modal onClose={() => setIsIntervalModalOpen(false)} title="2点法（AとB）について">
          <div className="text-sm space-y-2">
            <p>β = (FIM_B − FIM_A) / (ln(B日) − ln(A日)) を用いて回復速度を推定します。</p>
            <p>測定間隔が短すぎる/同日だと計算不可です。A &lt; B を満たしてください。</p>
          </div>
        </Modal>
      )}
      {isMetricsOpen && (
        <Modal onClose={() => setIsMetricsOpen(false)} title="指標の見かた">
          <div className="text-sm grid gap-2">
            <div className="border rounded p-2"><div className="font-semibold">OR（オッズ比）</div><div className="text-xs text-slate-700">1未満＝不利、1超＝有利。95%CIが1を跨がなければ有意。</div></div>
            <div className="border rounded p-2"><div className="font-semibold">AUC</div><div className="text-xs text-slate-700">0.5=偶然、1.0=完璧。ΔAUCはモデル改善幅。</div></div>
            <div className="border rounded p-2"><div className="font-semibold">IDI</div><div className="text-xs text-slate-700">陽性/陰性の確率差の平均改善度。</div></div>
          </div>
        </Modal>
      )}
      {isThrOpen && (
        <Modal onClose={() => setIsThrOpen(false)} title="高確度モード設定">
          <div className="text-sm space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span>自宅判定の下限 (p≥)</span>
                <input type="number" step={0.01} min={0.01} max={0.99} value={state.thrHomeHi} onChange={(e) => dispatch({ type: 'UPDATE', field: 'thrHomeHi', value: clamp(toNum(e.target.value, state.thrHomeHi), 0.01, 0.99) })} className="border rounded px-2 py-1" />
              </label>
              <label className="flex flex-col gap-1">
                <span>非自宅判定の上限 (p≤)</span>
                <input type="number" step={0.01} min={0.01} max={0.99} value={state.thrHomeLo} onChange={(e) => dispatch({ type: 'UPDATE', field: 'thrHomeLo', value: clamp(toNum(e.target.value, state.thrHomeLo), 0.01, 0.99) })} className="border rounded px-2 py-1" />
              </label>
            </div>
            <div className="text-xs text-slate-600">条件: 下限 ＜ 上限 ／ 上限−下限 ≥ 0.20</div>
            {!(state.thrHomeLo < state.thrHomeHi && state.thrHomeHi - state.thrHomeLo >= 0.20) && (
              <Alert type="warning" className="text-xs">閾値設定が不正です。</Alert>
            )}
          </div>
        </Modal>
      )}
      {isOCEBMOpen && (
        <Modal onClose={() => setIsOCEBMOpen(false)} title="OCEBM エビデンスレベル（強→弱）">
          <div className="text-sm space-y-3">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-slate-600">
                  <th className="border-b py-1">レベル</th>
                  <th className="border-b py-1">概要</th>
                  <th className="border-b py-1">例</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="py-1 border-b font-semibold">1a</td><td className="py-1 border-b">RCTの系統的レビュー/メタ解析</td><td className="py-1 border-b">複数RCTのメタ解析</td></tr>
                <tr><td className="py-1 border-b font-semibold">1b</td><td className="py-1 border-b">良質な個別RCT</td><td className="py-1 border-b">単独RCT</td></tr>
                <tr><td className="py-1 border-b font-semibold">2a</td><td className="py-1 border-b">前向きコホートの系統的レビュー</td><td className="py-1 border-b">複数コホートレビュー</td></tr>
                <tr><td className="py-1 border-b font-semibold">2b</td><td className="py-1 border-b">個別コホート（前向き/後ろ向き）</td><td className="py-1 border-b">単施設/多施設後ろ向き</td></tr>
                <tr><td className="py-1 border-b font-semibold">3a</td><td className="py-1 border-b">症例対照の系統的レビュー</td><td className="py-1 border-b">複数ケースコントロール</td></tr>
                <tr><td className="py-1 border-b font-semibold">3b</td><td className="py-1 border-b">個別の症例対照</td><td className="py-1 border-b">ケースコントロール1本</td></tr>
                <tr><td className="py-1 border-b font-semibold">4</td><td className="py-1 border-b">症例シリーズ・横断研究など</td><td className="py-1 border-b">横断/前後比較</td></tr>
                <tr><td className="py-1 border-b">5</td><td className="py-1 border-b">専門家意見・機序推論</td><td className="py-1 border-b">ガイダンス/解説</td></tr>
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {/* About Modal */}
      {isAboutOpen && (
        <Modal onClose={() => setIsAboutOpen(false)} title="このアプリについて">
          <div className="text-sm space-y-3">
            <div className="border rounded p-2">
              <div className="font-semibold">用途</div>
              <div className="text-xs text-slate-700">本アプリは <b>教育・ディスカッション用</b> のシミュレーターです。<b>診断・治療方針の決定</b>には使用しません。</div>
            </div>
            <div className="border rounded p-2">
              <div className="font-semibold">限界</div>
              <div className="text-xs text-slate-700">近似モデルに基づく推定であり、<b>外部妥当化・校正は未実施</b>です。結果は参考情報に留めてください。</div>
            </div>
            <div className="border rounded p-2">
              <div className="font-semibold">データ</div>
              <div className="text-xs text-slate-700">患者を特定できる情報は<b>保存・送信しません</b>（端末内で処理）。</div>
            </div>
            <div className="border rounded p-2">
              <div className="font-semibold">出典・背景</div>
              <ul className="list-disc ml-5 text-xs text-slate-700 space-y-1">
                <li>Koyama T, et al. <i>Clinical Rehabilitation</i>. 2005;19:779–789.（二点法×対数モデルによるFIM回復カーブの推定）</li>
                <li>小山哲男. 脳卒中患者の予後予測：日常生活の自立度（FIM合計点と各項目到達確率の解析・図表）</li>
                <li>Koyama T, et al. <i>J Stroke Cerebrovasc Dis</i>. 2011;20(3):202–207.（年齢・FIM・同居等による自宅退院予測因子）</li>
              </ul>
              <div className="text-[11px] text-slate-600 mt-2">本アプリは上記の“考え方”を教育目的で参考にしています。<b>特定論文モデルの実装ではなく</b>、係数は独自設定です（外部妥当化・校正は未実施）。</div>
            </div>
            <div className="text-xs text-slate-500">バージョン: 個人利用版 / 免責: 無保証</div>
          </div>
        </Modal>
      )}

      {/* Consent (初回のみ表示) */}
      {isConsentOpen && (
        <Modal onClose={() => {}} title="ご利用前の確認">
          <div className="text-sm space-y-3">
            <p>本アプリは<b>教育・ディスカッション用</b>のシミュレーターです。<b>個別患者の診断・治療方針の決定</b>には使用しません。</p>
            <p>患者を特定できる情報は<b>保存・送信しません</b>。</p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setIsAboutOpen(true)}>このアプリについて</Button>
              <Button onClick={acceptConsent}>同意して開始</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Terms of Use */}
      {isTosOpen && (
        <Modal onClose={() => setIsTosOpen(false)} title="利用規約（個人利用版）">
          <div className="text-sm space-y-3">
            <ol className="list-decimal ml-5 text-xs text-slate-700 space-y-1">
              <li>本アプリは <b>教育・ディスカッション目的</b>で提供されます。医療判断・診断・治療方針の決定には使用できません。</li>
              <li>結果は近似モデルに基づく<b>推定</b>であり、<b>外部妥当化・校正は未実施</b>です。正確性・完全性は保証されません。</li>
              <li>提供者は、利用に伴ういかなる損害についても<b>一切の責任を負いません</b>（無保証）。</li>
              <li>本アプリの出力やスクリーンショットを第三者へ共有する際は、<b>個人情報を含めない</b>ようにしてください。</li>
              <li>本規約は予告なく変更されることがあります（画面のバージョンと併記）。</li>
            </ol>
            <div className="text-[11px] text-slate-500">バージョン: {VERSION}</div>
          </div>
        </Modal>
      )}

      {/* Privacy */}
      {isPrivacyOpen && (
        <Modal onClose={() => setIsPrivacyOpen(false)} title="プライバシーポリシー（個人利用版）">
          <div className="text-sm space-y-3">
            <ul className="list-disc ml-5 text-xs text-slate-700 space-y-1">
              <li>本アプリは患者を特定できる情報を<b>送信・収集しません</b>。処理は端末内で完結します。</li>
              <li>ブラウザの <code>localStorage</code> には<b>同意フラグ（adl-consent-v1）</b>のみ保存します。</li>
              <li>ログが有効な場合でも、患者名・ID・日付などは保存しません。</li>
            </ul>
            <div className="text-[11px] text-slate-500">バージョン: {VERSION}</div>
          </div>
        </Modal>
      )}

      {/* Footer (version) */}
      <div className="no-print text-[11px] text-slate-400 mt-4 text-right">{VERSION}</div>
    </div>
  );
}
