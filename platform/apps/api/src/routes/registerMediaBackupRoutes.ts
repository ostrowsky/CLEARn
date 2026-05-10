import type { FastifyInstance } from 'fastify';
import { AdminAuthService } from '../modules/admin/adminAuth.service';
import { BackupService } from '../modules/backup/backup.service';

async function requireAdminSession(
  adminAuthService: AdminAuthService,
  request: { headers: { cookie?: string } },
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
) {
  const status = await adminAuthService.getStatus(request.headers.cookie);
  if (status.configured && status.authenticated) {
    return true;
  }

  const message = status.configured ? 'Admin login is required.' : 'Admin account setup is required.';
  reply.code(401).send({
    statusCode: 401,
    error: 'Unauthorized',
    message,
    configured: status.configured,
  });
  return false;
}

export async function registerMediaBackupRoutes(app: FastifyInstance) {
  const adminAuthService = new AdminAuthService();
  const backupService = new BackupService();

  app.get('/api/admin/backup/media/export', async (request, reply) => {
    if (!await requireAdminSession(adminAuthService, request, reply)) {
      return reply;
    }

    const backup = await backupService.createMediaBackup();

    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', 'attachment; filename=' + JSON.stringify(backup.fileName))
      .send(backup.stream);
  });

  app.post('/api/admin/backup/media/import', async (request, reply) => {
    if (!await requireAdminSession(adminAuthService, request, reply)) {
      return reply;
    }

    const body = request.body as { fileName?: string; base64?: string };

    return backupService.restoreMediaBackup(
      String(body.fileName || 'clearn-media-backup.zip'),
      String(body.base64 || ''),
    );
  });
}
