import { SA_OPTIONS, midiToWestern, keyToMidi } from "../pitch";

interface SaSelectorProps {
  sa: string;
  onChange: (sa: string) => void;
}

/** 12 Western names; Sa is a label anchor only — pitch never retunes. */
export function SaSelector({ sa, onChange }: SaSelectorProps) {
  return (
    <div className="sa-selector" role="radiogroup" aria-label="Sa (movable tonic)">
      <span className="panel-label">Sa</span>
      {SA_OPTIONS.map((name) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={name === sa}
          className={`pill${name === sa ? " selected" : ""}`}
          onClick={() => onChange(name)}
        >
          {name}
        </button>
      ))}
      <span className="sa-hint">
        Sa = {sa} (key 12 stays {midiToWestern(keyToMidi(12))})
      </span>
    </div>
  );
}
