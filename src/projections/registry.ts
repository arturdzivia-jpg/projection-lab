import type { Projection, ProjectionId } from './types';
import { equirectangular } from './equirectangular';
import { mercator } from './mercator';
import { lambert } from './lambert';
import { orthographicTwin } from './orthographicTwin';
import { stereographicTwin } from './stereographicTwin';

export const projections: Record<ProjectionId, Projection> = {
  equirectangular,
  mercator,
  lambert,
  orthographicTwin,
  stereographicTwin,
};

export const projectionList: Projection[] = [
  equirectangular,
  mercator,
  lambert,
  orthographicTwin,
  stereographicTwin,
];

export function getProjection(id: ProjectionId): Projection {
  return projections[id];
}

export function isRegional(id: ProjectionId): boolean {
  return id === 'lambert';
}

export function isTwin(id: ProjectionId): boolean {
  return id === 'orthographicTwin' || id === 'stereographicTwin';
}
