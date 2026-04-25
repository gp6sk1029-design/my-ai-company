/**
 * ライフプランくん 計算エンジン（純粋関数）
 *
 * 外部依存なし。window.LIFEPLAN_CALC に公開してapp.jsから呼ぶ。
 * 将来 Node で単体テストしたくなったら export 形式に差し替え可能。
 *
 * 設計原則（CLAUDE.md の生産技術思考に準拠）:
 *   - 数値で判断する → すべて円・年単位で返す
 *   - 再現性 → 副作用なし、入力→出力が1対1
 *   - 費用対効果 → 税引き前/後を両方返して意思決定に使える状態にする
 */
(() => {
  'use strict';

  const NISA_ANNUAL_TSUMITATE = 1200000;
  const NISA_ANNUAL_GROWTH = 2400000;
  const NISA_LIFETIME_CAP = 18000000;
  const CAPITAL_GAIN_TAX = 0.20315;

  // ============================================================
  // 単一口座の複利推移を計算して年次配列を返す
  //   input: { initialBalance, monthlyContribution, annualReturn, years, taxable }
  //   output: [{year, contribution, balance, balanceAfterTax}, ...]
  // ============================================================
  function simulateAccount({ initialBalance = 0, monthlyContribution = 0, annualReturn = 0, years = 30, taxable = false }) {
    const out = [];
    let balance = initialBalance;
    let principal = initialBalance;
    for (let y = 1; y <= years; y++) {
      const contribYear = monthlyContribution * 12;
      balance = (balance + contribYear) * (1 + annualReturn);
      principal += contribYear;
      const gain = Math.max(0, balance - principal);
      const afterTax = taxable ? balance - gain * CAPITAL_GAIN_TAX : balance;
      out.push({
        year: y,
        contribution: contribYear,
        principal: Math.round(principal),
        balance: Math.round(balance),
        balanceAfterTax: Math.round(afterTax),
        gain: Math.round(gain),
        tax: Math.round(taxable ? gain * CAPITAL_GAIN_TAX : 0)
      });
    }
    return out;
  }

  // ============================================================
  // 新NISA（成長枠+つみたて枠、非課税、生涯1800万円）
  //   超過分は tokutei（課税特定口座）にオーバーフローさせる
  // ============================================================
  function simulateNisaWithOverflow({ initialBalance, monthlyContribution, annualReturn, years }) {
    const nisa = [];
    const overflow = [];
    let nisaBalance = initialBalance;
    let nisaPrincipal = initialBalance;
    let ovBalance = 0;
    let ovPrincipal = 0;

    for (let y = 1; y <= years; y++) {
      const annualContrib = monthlyContribution * 12;
      const remainingCap = Math.max(0, NISA_LIFETIME_CAP - nisaPrincipal);
      const annualCap = NISA_ANNUAL_TSUMITATE + NISA_ANNUAL_GROWTH;
      const toNisa = Math.min(annualContrib, remainingCap, annualCap);
      const toOverflow = annualContrib - toNisa;

      nisaBalance = (nisaBalance + toNisa) * (1 + annualReturn);
      nisaPrincipal += toNisa;

      ovBalance = (ovBalance + toOverflow) * (1 + annualReturn);
      ovPrincipal += toOverflow;

      const nisaGain = Math.max(0, nisaBalance - nisaPrincipal);
      const ovGain = Math.max(0, ovBalance - ovPrincipal);

      nisa.push({
        year: y,
        contribution: Math.round(toNisa),
        principal: Math.round(nisaPrincipal),
        balance: Math.round(nisaBalance),
        balanceAfterTax: Math.round(nisaBalance),
        gain: Math.round(nisaGain),
        tax: 0
      });
      overflow.push({
        year: y,
        contribution: Math.round(toOverflow),
        principal: Math.round(ovPrincipal),
        balance: Math.round(ovBalance),
        balanceAfterTax: Math.round(ovBalance - ovGain * CAPITAL_GAIN_TAX),
        gain: Math.round(ovGain),
        tax: Math.round(ovGain * CAPITAL_GAIN_TAX)
      });
    }
    return { nisa, overflow };
  }

  // ============================================================
  // 取崩フェーズ（4%ルール）
  //   残高から毎年 rate だけ取崩。取崩額は年次収入として返す。
  //   税は課税口座分のみ source別に案分して控除（簡易）
  // ============================================================
  function simulateDrawdown({ portfolioTaxable = 0, portfolioNontax = 0, annualReturn = 0.03, rate = 0.04, years = 30, shortfallNeeded = 0 }) {
    const out = [];
    let taxable = portfolioTaxable;
    let nontax = portfolioNontax;
    for (let y = 1; y <= years; y++) {
      const total = taxable + nontax;
      const drawdown = Math.max(shortfallNeeded, total * rate);
      const taxableShare = total > 0 ? taxable / total : 0;
      const fromTaxable = drawdown * taxableShare;
      const fromNontax = drawdown - fromTaxable;
      const taxPaid = fromTaxable * CAPITAL_GAIN_TAX * 0.5; // 譲渡益相当を50%仮定
      taxable = (taxable - fromTaxable) * (1 + annualReturn);
      nontax = (nontax - fromNontax) * (1 + annualReturn);
      if (taxable < 0) taxable = 0;
      if (nontax < 0) nontax = 0;
      out.push({
        year: y,
        drawdown: Math.round(drawdown),
        netReceived: Math.round(drawdown - taxPaid),
        taxablePortfolio: Math.round(taxable),
        nontaxPortfolio: Math.round(nontax),
        totalPortfolio: Math.round(taxable + nontax),
        exhausted: taxable + nontax <= 0
      });
      if (taxable + nontax <= 0) break;
    }
    return out;
  }

  // ============================================================
  // 年次教育費を子供1人分・0〜22歳で展開
  //   child: {birthYear, plan: {pre, es, jhs, hs, univ}, juku: 'none'|'light'|'standard'|'heavy'}
  //   dataset: education-costs.json
  //   return: {[childAge]: yen}
  // ============================================================
  function buildEducationByAge(child, dataset) {
    const result = {};
    const { stages, juku } = dataset;
    const jukuCost = juku[child.juku || 'none'] || 0;

    for (const stageKey of Object.keys(stages)) {
      const stage = stages[stageKey];
      const plan = child.plan?.[stageKey] || 'public';
      // 大学は private_bunkei/rikei/med のキー、それ以外は public/private
      let cost = 0;
      if (stageKey === 'univ') {
        cost = stage[plan] ?? stage.public;
      } else {
        cost = stage[plan === 'private' ? 'private' : 'public'];
      }
      for (let age = stage.fromAge; age <= stage.toAge; age++) {
        result[age] = (result[age] || 0) + cost;
      }
    }
    // 塾は幼〜高まで上乗せ（簡易）
    for (let age = 6; age <= 17; age++) {
      result[age] = (result[age] || 0) + jukuCost;
    }
    return result;
  }

  // ============================================================
  // ライフイベントを発生年にバラす
  //   event: {startAge, everyYears, amountDefault}
  //   return: {[age]: yen}
  // ============================================================
  function expandEventByAge(event, maxAge = 95) {
    const result = {};
    if (!event || !event.startAge) return result;
    const amount = event.amount ?? event.amountDefault ?? 0;
    const every = event.everyYears ?? 0;
    if (every <= 0) {
      // 単発
      result[event.startAge] = (result[event.startAge] || 0) + amount;
    } else {
      for (let age = event.startAge; age <= maxAge; age += every) {
        result[age] = (result[age] || 0) + amount;
      }
    }
    return result;
  }

  // ============================================================
  // 年齢区間の定額(月額 or 年額)を年次に展開
  //   item: {fromAge, toAge, monthlyAmount?, annualAmount?, inflationRate?}
  //   baseAge: 基準年齢（インフレ起点）
  //   return: {[age]: yen}
  // ============================================================
  function expandPeriodicByAge(item, baseAge = 30) {
    const result = {};
    if (!item) return result;
    const from = item.fromAge ?? 0;
    const to = item.toAge ?? 95;
    const yearly = (item.annualAmount ?? 0) + (item.monthlyAmount ?? 0) * 12;
    const infl = item.inflationRate ?? 0;
    for (let age = from; age <= to; age++) {
      const yearsElapsed = Math.max(0, age - baseAge);
      const adjusted = yearly * Math.pow(1 + infl, yearsElapsed);
      result[age] = (result[age] || 0) + adjusted;
    }
    return result;
  }

  // ============================================================
  // 全体キャッシュフロー構築
  //   input: {
  //     self: {birthYear, currentAge, lifespan},
  //     incomes: [{memberId, fromAge, toAge, annualAmount, growthRate}],
  //     expenses: [{fromAge, toAge, monthlyAmount, inflationRate, category}],
  //     educations: [child],
  //     events: [{label, startAge, everyYears, amount, category}],
  //     assets: [{kind, currentBalance, monthlyContribution, expectedReturn, scenario}],
  //     educationDataset
  //   }
  //   return: {
  //     rows: [{year, age, income, expense, education, event, net, cashBalance, investmentBalance}],
  //     assetsByYear: [{year, nisa, tokutei, stock, crypto, cash}],
  //     exhaustedAge: number | null
  //   }
  // ============================================================
  function buildCashflow(input) {
    const { self, incomes = [], expenses = [], educations = [], events = [], assets = [], educationDataset } = input;
    const startAge = self.currentAge;
    const endAge = self.lifespan ?? 95;
    const years = endAge - startAge + 1;
    const thisYear = new Date().getFullYear();

    // 年齢軸に展開
    const incomeByAge = {};
    for (const inc of incomes) {
      const exp = expandPeriodicByAge({ fromAge: inc.fromAge, toAge: inc.toAge, annualAmount: inc.annualAmount, inflationRate: inc.growthRate }, startAge);
      for (const a in exp) incomeByAge[a] = (incomeByAge[a] || 0) + exp[a];
    }

    const expenseByAge = {};
    for (const ex of expenses) {
      const exp = expandPeriodicByAge(ex, startAge);
      for (const a in exp) expenseByAge[a] = (expenseByAge[a] || 0) + exp[a];
    }

    const educationByAge = {};
    if (educationDataset) {
      for (const child of educations) {
        const e = buildEducationByAge(child, educationDataset);
        const offset = (child.birthYear ?? thisYear) - (thisYear - startAge);
        for (const childAge in e) {
          const selfAge = startAge + (parseInt(childAge) - (thisYear - (child.birthYear ?? thisYear))) - offset + offset;
          const parentAge = startAge + (parseInt(childAge) + (thisYear - (child.birthYear ?? thisYear)));
          // 子供年齢→自分の年齢への写像: self_age = current_self_age + (child_age - current_child_age)
          const currentChildAge = thisYear - (child.birthYear ?? thisYear);
          const mappedSelfAge = startAge + (parseInt(childAge) - currentChildAge);
          if (mappedSelfAge >= startAge && mappedSelfAge <= endAge) {
            educationByAge[mappedSelfAge] = (educationByAge[mappedSelfAge] || 0) + e[childAge];
          }
        }
      }
    }

    const eventByAge = {};
    for (const ev of events) {
      const e = expandEventByAge(ev, endAge);
      for (const a in e) eventByAge[a] = (eventByAge[a] || 0) + e[a];
    }

    // 資産の複利シミュ（口座別）
    const assetSeries = {}; // {kind: [{year, balance}]}
    for (const asset of assets) {
      if (asset.kind === 'nisa_tsumitate' || asset.kind === 'nisa_growth') {
        const { nisa, overflow } = simulateNisaWithOverflow({
          initialBalance: asset.currentBalance ?? 0,
          monthlyContribution: asset.monthlyContribution ?? 0,
          annualReturn: asset.expectedReturn ?? 0.04,
          years
        });
        const key = asset.kind;
        if (!assetSeries[key]) assetSeries[key] = nisa;
        if (overflow.some(r => r.balance > 0)) {
          assetSeries.tokutei_overflow = overflow;
        }
      } else {
        const ret = asset.kind === 'stock' || asset.kind === 'crypto'
          ? (asset.scenario === 'strong' ? 0.12 : asset.scenario === 'weak' ? -0.03 : 0.05)
          : (asset.expectedReturn ?? 0.01);
        const taxable = asset.kind === 'tokutei' || asset.kind === 'stock' || asset.kind === 'crypto';
        const sim = simulateAccount({
          initialBalance: asset.currentBalance ?? 0,
          monthlyContribution: asset.monthlyContribution ?? 0,
          annualReturn: ret,
          years,
          taxable
        });
        assetSeries[asset.kind] = sim;
      }
    }

    const rows = [];
    let cash = 0;
    let exhaustedAge = null;
    for (let i = 0; i < years; i++) {
      const age = startAge + i;
      const year = thisYear + i;
      const income = Math.round(incomeByAge[age] || 0);
      const expense = Math.round(expenseByAge[age] || 0);
      const education = Math.round(educationByAge[age] || 0);
      const event = Math.round(eventByAge[age] || 0);
      const net = income - expense - education - event;
      cash += net;

      const invBalance = Object.entries(assetSeries).reduce((sum, [k, arr]) => {
        const row = arr[i];
        return sum + (row ? (k === 'tokutei' || k === 'stock' || k === 'crypto' || k === 'tokutei_overflow' ? row.balanceAfterTax : row.balance) : 0);
      }, 0);

      const totalAssets = cash + invBalance;
      if (exhaustedAge === null && totalAssets < 0 && age >= (self.retireAge ?? 65)) {
        exhaustedAge = age;
      }

      rows.push({
        year,
        age,
        income,
        expense,
        education,
        event,
        net,
        cashBalance: Math.round(cash),
        investmentBalance: Math.round(invBalance),
        totalAssets: Math.round(totalAssets)
      });
    }

    return {
      rows,
      assetSeries,
      exhaustedAge
    };
  }

  // ============================================================
  // 公開
  // ============================================================
  window.LIFEPLAN_CALC = {
    simulateAccount,
    simulateNisaWithOverflow,
    simulateDrawdown,
    buildEducationByAge,
    expandEventByAge,
    expandPeriodicByAge,
    buildCashflow,
    // 定数（UIから参照用）
    NISA_LIFETIME_CAP,
    NISA_ANNUAL_TSUMITATE,
    NISA_ANNUAL_GROWTH,
    CAPITAL_GAIN_TAX
  };
})();
