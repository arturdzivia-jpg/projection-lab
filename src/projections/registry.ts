import type { Projection, ProjectionId } from './types';
import { equirectangular } from './equirectangular';
import { mercator } from './mercator';
import { lambert } from './lambert';
import { hemispheres } from './hemispheres';

export const projections: Record<ProjectionId, Projection> = {
  equirectangular,
  mercator,
  lambert,
  hemispheres,
};

export const projectionList: Projection[] = [equirectangular, mercator, lambert, hemispheres];

export function getProjection(id: ProjectionId): Projection {
  return projections[id];
}

export function isRegional(id: ProjectionId): boolean {
  return id === 'lambert';
}
