import { SA_OPTIONS } from "../pitch";
import type { Notation } from "../types";
import { IconEditJson, IconExport } from "./Icons";

interface TopBarProps {
  sa: string;
  onSa: (sa: string) => void;
  notation: Notation;
  onNotation: (n: Notation) => void;
  onEditJson: () => void;
  onExportJson: () => void;
  status: string;
}

export function TopBar({ sa, onSa, notation, onNotation, onEditJson, onExportJson, status }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <h1>Harmonium</h1>
        <span className="status">{status}</span>
      </div>
      <nav className="topbar-actions" aria-label="Score and view controls">
        <button type="button" className="icon-btn" onClick={onEditJson} title="Edit JSON in a new tab">
          <IconEditJson />
          <span>Edit JSON</span>
        </button>
        <button type="button" className="icon-btn" onClick={onExportJson} title="Download the score as JSON">
          <IconExport />
          <span>Export JSON</span>
        </button>
        <label className="select-wrap" data-control="notation">
          <span className="select-label">Notation</span>
          <select value={notation} onChange={(e) => onNotation(e.target.value as Notation)}>
            <option value="western">Western</option>
            <option value="sargam">Sargam</option>
            <option value="both">Both</option>
          </select>
        </label>
        <label className="select-wrap" data-control="sa">
          <span className="select-label">Sa</span>
          <select value={sa} onChange={(e) => onSa(e.target.value)}>
            {SA_OPTIONS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </nav>
    </header>
  );
}
