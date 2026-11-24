import { z } from 'zod';
import { HEX_RE } from './color.ts';

export const MAX_TEAMS = 12;
export const MIN_TEAMS = 2;
export const MAX_POINTS = 10_000;

/** Empty / whitespace-only strings become null. */
const optionalText = (max: number) =>
  z
    .string()
    .max(500)
    .transform((s) => s.trim())
    .pipe(z.string().max(max))
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const Hex = z
  .string()
  .regex(HEX_RE, 'Expected a #RRGGBB color')
  .transform((s) => s.toUpperCase());

export const CategorySchema = z.enum(['sports', 'esports', 'chess', 'academic', 'general']);
export const ThemeModeSchema = z.enum(['daylight', 'arena']);
export const EventStatusSchema = z.enum(['active', 'archived']);

const Name = (max: number) => z.string().trim().min(1).max(max);
const ShortName = z
  .string()
  .trim()
  .min(1)
  .max(4)
  .regex(/^[\p{L}\p{N}]+$/u, 'Letters and digits only')
  .transform((s) => s.toUpperCase());

const uniqueNames = (teams: { name: string }[]) =>
  new Set(teams.map((t) => t.name.toLowerCase())).size === teams.length;

// ---------- Houses ----------

export const HouseInput = z.object({
  name: Name(40),
  short_name: ShortName.optional(),
  color_hex: Hex,
  icon_key: z.string().trim().max(32).nullable().optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
});
export type HouseInput = z.infer<typeof HouseInput>;

export const HousePatch = HouseInput.partial().extend({
  /** Also update name/short/color of linked teams in ACTIVE events (default true). */
  sync_teams: z.boolean().optional(),
});

// ---------- Teams ----------

export const TeamInput = z.object({
  name: Name(40),
  short_name: ShortName.optional(),
  color_hex: Hex,
  house_id: z.number().int().positive().nullable().optional(),
});
export type TeamInput = z.infer<typeof TeamInput>;

export const TeamPatch = TeamInput.partial();

export const OrderInput = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
});

// ---------- Events ----------

export const CreateEventInput = z.object({
  name: Name(80),
  category: CategorySchema.default('general'),
  theme_mode: ThemeModeSchema.default('daylight'),
  counts_toward_season: z.boolean().default(true),
  announcement_text: optionalText(280),
  teams: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('houses') }),
    z.object({
      mode: z.literal('custom'),
      teams: z
        .array(TeamInput)
        .min(MIN_TEAMS)
        .max(MAX_TEAMS)
        .refine(uniqueNames, 'Team names must be unique'),
    }),
  ]),
});
export type CreateEventInput = z.infer<typeof CreateEventInput>;

export const PatchEventInput = z
  .object({
    name: Name(80),
    category: CategorySchema,
    theme_mode: ThemeModeSchema,
    counts_toward_season: z.boolean(),
    status: EventStatusSchema,
    announcement_text: optionalText(280),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

export const FreezeInput = z.object({ frozen: z.boolean() });
export const FeatureInput = z.object({ featured: z.boolean() });
export const DeleteEventInput = z.object({ confirm_slug: z.string().min(1) });

// ---------- Scoring ----------

export const BatchId = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'Expected a UUID')
  .transform((s) => s.toLowerCase());

export const CreateBatchInput = z.object({
  batch_id: BatchId,
  label: optionalText(60),
  judge_name: optionalText(40),
  awards: z
    .array(
      z.object({
        event_team_id: z.number().int().positive(),
        points: z
          .number()
          .int()
          .min(-MAX_POINTS)
          .max(MAX_POINTS)
          .refine((p) => p !== 0, 'Points must be non-zero'),
      }),
    )
    .min(1)
    .max(MAX_TEAMS)
    .refine((a) => new Set(a.map((x) => x.event_team_id)).size === a.length, 'Each team may appear once per batch'),
});
export type CreateBatchInput = z.infer<typeof CreateBatchInput>;

// ---------- Auth ----------

export const JudgeSessionInput = z.union([
  z.object({ token: z.string().trim().min(22).max(128), judge_name: optionalText(40) }),
  z.object({ pin: z.string().regex(/^\d{4}$/, 'PIN must be 4 digits'), judge_name: optionalText(40) }),
]);
export type JudgeSessionInput = z.infer<typeof JudgeSessionInput>;

export const AdminLoginInput = z.object({ passcode: z.string().min(1).max(200) });

// ---------- Queries ----------

export const LedgerQuery = z.object({
  team: z.coerce.number().int().positive().optional(),
  label: z.string().trim().min(1).max(60).optional(),
  state: z.enum(['active', 'reverted']).optional(),
  cursor: z
    .string()
    .regex(/^\d+:[0-9a-f-]{36}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ScoreboardQuery = z.object({
  event: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/)
    .optional(),
  scope: z.literal('season').optional(),
});
