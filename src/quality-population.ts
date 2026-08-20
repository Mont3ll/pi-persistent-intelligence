import type { MemoryStatus } from "./types";

export type MemoryQualityPopulation = "active" | "review" | "historical";
export type RelationshipQualityPopulation = "active" | "historical" | "auxiliary";

export function memoryQualityPopulation(status: MemoryStatus): MemoryQualityPopulation {
  if (status === "active") return "active";
  if (status === "contested") return "review";
  return "historical";
}

export function relationshipQualityPopulation(
  memoryEndpointIds: string[],
  populationByMemoryId: ReadonlyMap<string, MemoryQualityPopulation>,
): RelationshipQualityPopulation {
  if (memoryEndpointIds.length === 0) return "auxiliary";
  const knownPopulations = memoryEndpointIds.flatMap((id) => {
    const population = populationByMemoryId.get(id);
    return population ? [population] : [];
  });
  return knownPopulations.includes("active") && knownPopulations.every((population) => population === "active") ? "active" : "historical";
}
