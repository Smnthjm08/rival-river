import type { PublicKey } from "@solana/web3.js";
import { cn } from "@/lib/utils";

export const CHARACTERS = ["heron", "otter", "pike", "kingfisher", "frog", "ferryman"] as const;
export type Character = (typeof CHARACTERS)[number];

export const CHARACTER_NAMES: Record<Character, string> = {
  heron: "The Heron",
  otter: "The Otter",
  pike: "The Pike",
  kingfisher: "The Kingfisher",
  frog: "The Frog",
  ferryman: "The Ferryman",
};

const BG: Record<Character, string> = {
  heron: "#14504E",
  otter: "#5B3E24",
  pike: "#0A2A29",
  kingfisher: "#183B5A",
  frog: "#2E5E3A",
  ferryman: "#0F1F21",
};

/**
 * Only wallet addresses exist on chain, so each seat gets a character
 * derived from its address: the same wallet always looks the same, and the
 * two players at a table never share one.
 */
export function charactersFor(creator: PublicKey, opponent: PublicKey): [Character, Character] {
  const pick = (k: PublicKey) => k.toBytes().reduce((a, b) => a + b, 0) % CHARACTERS.length;
  const a = pick(creator);
  let b = pick(opponent);
  if (b === a) b = (b + 1) % CHARACTERS.length;
  return [CHARACTERS[a], CHARACTERS[b]];
}

export type SeatState = "idle" | "turn" | "winner" | "folded";

/** Kit avatar. `turn` rings it in river, `winner` in brass, `folded` dims it. */
export function SeatAvatar({ who, size = 52, state = "idle", className }: { who: Character; size?: number; state?: SeatState; className?: string }) {
  const ring =
    state === "turn"
      ? `0 0 0 ${Math.max(2, size * 0.03)}px var(--ink), 0 0 0 ${Math.max(4, size * 0.06)}px var(--river)`
      : state === "winner"
        ? `0 0 0 ${Math.max(2, size * 0.03)}px var(--ink), 0 0 0 ${Math.max(4, size * 0.06)}px var(--brass)`
        : `0 0 0 ${Math.max(1, size * 0.012)}px rgb(232 236 234 / 0.16)`;
  return (
    <div
      role="img"
      aria-label={`${CHARACTER_NAMES[who]} avatar`}
      className={cn("relative shrink-0 rounded-full transition-[box-shadow,opacity]", state === "folded" && "opacity-40", className)}
      style={{ width: size, height: size, boxShadow: ring }}
    >
      <svg viewBox="0 0 160 160" aria-hidden="true" className="block size-full rounded-full">
        <circle cx="80" cy="80" r="80" fill={BG[who]} />
        <CharacterArt who={who} />
      </svg>
    </div>
  );
}

function CharacterArt({ who }: { who: Character }) {
  switch (who) {
    case "heron":
      return (
        <g>
          <ellipse cx="68" cy="128" rx="34" ry="20" fill="#DDE6E3" />
          <path d="M76 116 C 90 94 62 86 72 62" fill="none" stroke="#DDE6E3" strokeWidth="12" strokeLinecap="round" />
          <circle cx="78" cy="56" r="13" fill="#DDE6E3" />
          <path d="M72 47 L54 38" stroke="#0B1416" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M89 53 L128 60 L89 63 Z" fill="#E0A84A" />
          <circle cx="83" cy="54" r="2.8" fill="#0B1416" />
          <path d="M44 126 C 56 118 72 118 86 126" fill="none" stroke="#9FB3AE" strokeWidth="3" strokeLinecap="round" />
        </g>
      );
    case "otter":
      return (
        <g>
          <ellipse cx="80" cy="160" rx="54" ry="30" fill="#A87545" />
          <circle cx="48" cy="58" r="13" fill="#A87545" />
          <circle cx="48" cy="58" r="6" fill="#6E4A2E" />
          <circle cx="112" cy="58" r="13" fill="#A87545" />
          <circle cx="112" cy="58" r="6" fill="#6E4A2E" />
          <circle cx="80" cy="90" r="42" fill="#A87545" />
          <ellipse cx="80" cy="108" rx="25" ry="17" fill="#EAD9BD" />
          <ellipse cx="80" cy="98" rx="8" ry="6" fill="#0B1416" />
          <circle cx="64" cy="82" r="5" fill="#0B1416" />
          <circle cx="96" cy="82" r="5" fill="#0B1416" />
          <g stroke="#0B1416" strokeWidth="1.8" strokeLinecap="round">
            <path d="M58 107 L34 102" />
            <path d="M58 113 L34 117" />
            <path d="M102 107 L126 102" />
            <path d="M102 113 L126 117" />
          </g>
        </g>
      );
    case "pike":
      return (
        <g>
          <path d="M86 58 L106 42 L110 62 Z" fill="#4F7A44" />
          <path d="M126 84 L152 62 L146 84 L152 106 Z" fill="#4F7A44" />
          <path d="M20 84 C 42 50 112 50 132 84 C 112 116 42 116 20 84 Z" fill="#6F9A5E" />
          <path d="M28 90 C 52 110 108 110 128 90 C 108 102 52 102 28 90 Z" fill="#D7E3C4" />
          <circle cx="70" cy="74" r="3.2" fill="#A9C792" />
          <circle cx="88" cy="80" r="3.2" fill="#A9C792" />
          <circle cx="104" cy="72" r="3.2" fill="#A9C792" />
          <circle cx="98" cy="91" r="2.6" fill="#A9C792" />
          <circle cx="44" cy="77" r="7.5" fill="#F6F1E7" />
          <circle cx="45" cy="77" r="3.8" fill="#0B1416" />
          <path d="M21 85 L40 89" stroke="#0B1416" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      );
    case "kingfisher":
      return (
        <g>
          <circle cx="74" cy="100" r="42" fill="#2B7BB9" />
          <path d="M36 104 C 42 136 106 136 112 104 C 96 118 52 118 36 104 Z" fill="#E07B39" />
          <circle cx="82" cy="70" r="27" fill="#1F5F94" />
          <ellipse cx="100" cy="84" rx="9" ry="6.5" fill="#F6F1E7" />
          <path d="M102 68 L152 77 L102 84 Z" fill="#0B1416" />
          <circle cx="90" cy="68" r="6" fill="#F6F1E7" />
          <circle cx="91" cy="68" r="3" fill="#0B1416" />
        </g>
      );
    case "frog":
      return (
        <g>
          <circle cx="52" cy="70" r="19" fill="#8CC06A" />
          <circle cx="108" cy="70" r="19" fill="#8CC06A" />
          <ellipse cx="80" cy="106" rx="56" ry="40" fill="#8CC06A" />
          <circle cx="52" cy="68" r="11" fill="#F6F1E7" />
          <circle cx="108" cy="68" r="11" fill="#F6F1E7" />
          <ellipse cx="52" cy="68" rx="6.5" ry="3.8" fill="#0B1416" />
          <ellipse cx="108" cy="68" rx="6.5" ry="3.8" fill="#0B1416" />
          <path d="M42 112 Q 80 136 118 112" fill="none" stroke="#2E5E3A" strokeWidth="4.5" strokeLinecap="round" />
          <circle cx="42" cy="118" r="7" fill="#E07B39" fillOpacity="0.55" />
          <circle cx="118" cy="118" r="7" fill="#E07B39" fillOpacity="0.55" />
        </g>
      );
    case "ferryman":
      return (
        <g>
          <circle cx="124" cy="124" r="22" fill="#E0A84A" fillOpacity="0.18" />
          <path d="M28 170 C 28 90 52 38 80 38 C 108 38 132 90 132 170 Z" fill="#14504E" />
          <circle cx="80" cy="96" r="25" fill="#D9B48F" />
          <path d="M53 90 C 58 66 102 66 107 90 C 97 79 63 79 53 90 Z" fill="#0A2A29" />
          <path d="M68 99 L76 99" stroke="#0B1416" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M84 99 L92 99" stroke="#0B1416" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M124 94 L124 112" stroke="#E0A84A" strokeWidth="2.5" strokeLinecap="round" />
          <rect x="115" y="112" width="18" height="22" rx="4" fill="#E0A84A" />
          <rect x="120" y="117" width="8" height="12" rx="2" fill="#F6F1E7" fillOpacity="0.75" />
        </g>
      );
  }
}
