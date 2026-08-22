const { runApprovedSync } = require('../api/_maintenance-20260822');

async function main() {
  const approvedCommitMessage = 'Retry one-time approved production catalog sync';
  if (process.env.VERCEL_ENV !== 'production' || process.env.VERCEL_GIT_COMMIT_MESSAGE !== approvedCommitMessage) {
    console.log('One-time production catalog sync skipped for this deployment.');
    return;
  }
  const result = await runApprovedSync();
  console.log(JSON.stringify({
    productionCatalogSync: true,
    salesEnabled: result.completed.salesEnabled,
    paymentProvider: result.completed.paymentProvider,
    paymentLive: result.completed.paymentLive,
    businessReady: result.completed.businessReady,
    cjAccountReady: result.completed.cjAccountReady,
    aliExpressAccountReady: result.completed.aliExpressAccountReady,
    keptProductIds: result.completed.kept.map((row) => row.id),
    removedProductIds: result.completed.removed.map((row) => row.id)
  }));
}

main().catch((error) => {
  console.error(`Production catalog sync failed: ${String(error.message || error).slice(0, 180)}`);
  process.exitCode = 1;
});
