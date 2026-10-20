// Deviations as data: each setting in which a preset differs from Ultracite's, with its reason.

/** A setting in which a preset differs from Ultracite's, kept with its reason. */
export type Deviation<Setting> = { setting: Setting; reason: string };

/** The settings of a record of deviations: each name keeps its own setting's type. */
type Settings<Deviations extends Record<string, Deviation<unknown>>> = {
  [Name in keyof Deviations]: Deviations[Name]["setting"];
};

/**
 * The settings of a preset's deviations, each under its rule or option name, without the reasons:
 * what a preset sets as its rules or spreads into its options.
 */
export function settingsOf<Deviations extends Record<string, Deviation<unknown>>>(
  deviations: Deviations,
): Settings<Deviations> {
  const settings = Object.fromEntries(
    Object.entries(deviations).map(([name, deviation]) => [name, deviation.setting]),
  );
  // Object.fromEntries gives every value one type; each name keeps its own setting's type here.
  return settings as Settings<Deviations>;
}
