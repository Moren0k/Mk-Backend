import { Get } from '@nestjs/common';

import { HealthSnapshotService } from '../../../application/observability/health-snapshot.service';
import { ApiResource } from '../../common/decorators/api-resource.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { toHealthVm } from '../../contracts/mappers/health.mapper';
import type { HealthVm } from '../../contracts/view-models/health.vm';

/**
 * GET /api/v1/health — único recurso público de la API (Mk-Api.md §7.1.1,
 * Anexo D §7): incluye `db` desde el día uno, sin esperar a que se active
 * `jugadas` en Fase 6. `/healthz` (raw, registrado en main.ts) sigue
 * existiendo en paralelo para healthchecks de plataforma.
 */
@ApiResource('health')
export class HealthController {
  constructor(private readonly healthSnapshotService: HealthSnapshotService) {}

  @Public()
  @Get()
  async getHealth(): Promise<HealthVm> {
    const snapshot = await this.healthSnapshotService.getSnapshot();
    return toHealthVm(snapshot);
  }
}
