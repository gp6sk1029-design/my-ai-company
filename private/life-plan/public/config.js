// ライフプランくん クライアント設定（公開される、秘密情報は書かない）
window.LIFEPLAN_CONFIG = {
  SYNC_URL: '/api/sync',
  MF_IMPORT_URL: '/api/mf-import',
  DEFAULTS: {
    retireAge: 65,
    lifespan: 95,
    inflationRate: 0.01,
    nisaAnnualCapTsumitate: 1200000,
    nisaAnnualCapGrowth: 2400000,
    nisaLifetimeCap: 18000000,
    capitalGainTax: 0.20315,
    drawdownRate: 0.04,
    returnPresets: {
      sp500: 0.05,
      world: 0.04,
      balanced: 0.03,
      bond: 0.01
    },
    stockScenarios: {
      strong: 0.12,
      neutral: 0.05,
      weak: -0.03
    }
  }
};
