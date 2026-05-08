import type { Projection, ProjectionId } from './types';
import { equirectangular } from './equirectangular';
import { mercator } from './mercator';
import { lambert } from './lambert';

export const projections: Record<ProjectionId, Projection> = {
  equirectangular,
  mercator,
  lambert,
};

export const projectionList: Projection[] = [equirectangular, mercator, lambert];

export function getProjection(id: ProjectionId): Projection {
  return projections[id];
}

export function isRegional(id: ProjectionId): boolean {
  return id === 'lambert';
}
