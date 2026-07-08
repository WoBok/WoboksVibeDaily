const { ManifestService } = require('../server/services/manifestService');

(async () => {
  const manifestService = new ManifestService();
  const result = await manifestService.init({ cleanup: true });

  for (const item of result.deleted) {
    console.log(`[cleanup] removed ${item}`);
  }

  console.log(`[manifest] ${result.totalArticles} articles`);
  console.log('[manifest] wrote notes/_manifest.json and leaf manifests');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
