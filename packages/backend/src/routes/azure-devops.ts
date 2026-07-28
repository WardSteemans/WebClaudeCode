import express from 'express';
import * as azureDevOps from '../integrations/azure-devops.js';

export function registerAzureDevOpsRoutes(app: express.Express): void {
  app.post('/api/azure-devops/connect', express.json(), async (req, res) => {
    try {
      const { orgUrl, pat } = req.body;
      if (!orgUrl || !pat) return res.status(400).json({ error: 'orgUrl and pat required' });
      const ok = await azureDevOps.connect({ orgUrl, pat });
      const user = azureDevOps.getAuthenticatedUser();
      res.json({ connected: ok, error: azureDevOps.getConnectionError(), user });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post('/api/azure-devops/disconnect', (_req, res) => {
    azureDevOps.disconnect();
    res.json({ ok: true });
  });

  app.get('/api/azure-devops/info', (_req, res) => {
    res.json(azureDevOps.getConnectionInfo());
  });

  app.get('/api/azure-devops/projects', async (req, res) => {
    try {
      const projects = await azureDevOps.getProjects();
      res.json(projects);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.get('/api/azure-devops/repositories', async (req, res) => {
    try {
      const project = req.query.project as string;
      if (!project) return res.status(400).json({ error: 'project query param required' });
      const repos = await azureDevOps.getRepositories(project);
      res.json(repos);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.get('/api/azure-devops/branches', async (req, res) => {
    try {
      const { project, repositoryId, filter } = req.query as Record<string, string>;
      if (!project || !repositoryId) return res.status(400).json({ error: 'project and repositoryId required' });
      const branches = await azureDevOps.getBranches(project, repositoryId, filter);
      res.json(branches);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.get('/api/azure-devops/pullrequests', async (req, res) => {
    try {
      const { project, repositoryId, status, top, skip, reviewerId } = req.query as Record<string, string>;
      if (!project || !repositoryId) return res.status(400).json({ error: 'project and repositoryId required' });
      const prs = await azureDevOps.getPullRequests(
        project,
        repositoryId,
        (status as any) || 'all',
        parseInt(top || '50', 10),
        parseInt(skip || '0', 10),
        reviewerId || undefined,
      );
      res.json(prs);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.get('/api/azure-devops/pullrequests/:prId', async (req, res) => {
    try {
      const { project, repositoryId } = req.query as Record<string, string>;
      const prId = parseInt(req.params.prId, 10);
      if (!project || !repositoryId || isNaN(prId)) {
        return res.status(400).json({ error: 'project, repositoryId and prId required' });
      }
      const detail = await azureDevOps.getPullRequestDetail(project, repositoryId, prId);
      res.json(detail);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.get('/api/azure-devops/workitems', async (req, res) => {
    try {
      const { project, ids } = req.query as Record<string, string>;
      if (!project || !ids) return res.status(400).json({ error: 'project and ids required' });
      const idList = ids.split(',').map(Number).filter(n => !isNaN(n));
      const items = await azureDevOps.getWorkItems(project, idList);
      res.json(items);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });
}
