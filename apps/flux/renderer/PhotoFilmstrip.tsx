import { memo, type KeyboardEvent, type MouseEvent } from "react";
import type { Photo } from "@lumacast/photo-model";

type SelectEvent = Pick<MouseEvent<HTMLButtonElement>, "shiftKey" | "metaKey" | "ctrlKey">;

type PhotoFilmstripProps = {
  photos: Photo[];
  selected: ReadonlySet<string>;
  activeId?: string;
  onSelect: (photoId: string, event: SelectEvent) => void;
  assetUrl: (photoId: string, revision: number) => string;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

type PhotoFilmstripRowProps = {
  id: string;
  name: string;
  revision: number;
  active: boolean;
  selected: boolean;
  onSelect: PhotoFilmstripProps["onSelect"];
  assetUrl: PhotoFilmstripProps["assetUrl"];
};

const PhotoFilmstripRow = memo(function PhotoFilmstripRow({
  id,
  name,
  revision,
  active,
  selected,
  onSelect,
  assetUrl,
}: PhotoFilmstripRowProps) {
  return (
    <button
      data-photo-id={id}
      aria-pressed={selected}
      title={name}
      className={`${active ? "active" : ""} ${selected ? "selected" : ""}`.trim()}
      onClick={(event) => onSelect(id, event)}
    >
      <img src={assetUrl(id, revision)} alt={name} loading="lazy" />
    </button>
  );
});

export const PhotoFilmstrip = memo(function PhotoFilmstrip({
  photos,
  selected,
  activeId,
  onSelect,
  assetUrl,
  onKeyDown,
}: PhotoFilmstripProps) {
  return (
    <div className="filmstrip" onKeyDown={onKeyDown}>
      {photos.map((photo) => (
        <PhotoFilmstripRow
          key={photo.id}
          id={photo.id}
          name={photo.name}
          revision={photo.revision}
          active={photo.id === activeId}
          selected={selected.has(photo.id)}
          onSelect={onSelect}
          assetUrl={assetUrl}
        />
      ))}
    </div>
  );
});
