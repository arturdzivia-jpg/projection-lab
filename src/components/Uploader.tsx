import { useCallback, useState } from 'react';

interface LoadedImage {
  image: HTMLImageElement;
  filename: string;
}

interface Props {
  onImages: (loaded: LoadedImage[]) => void;
  variant?: 'full' | 'compact';
}

/**
 * Image picker. Two visual modes:
 *  - `full` (default): a big drop-zone shown on the empty-state screen.
 *  - `compact`: a "+ Add region" button suitable for the sidebar.
 *
 * Either way, multiple files can be selected at once and decoded in parallel; the parent receives
 * a single `onImages` callback with all successfully decoded images.
 */
export function Uploader({ onImages, variant = 'full' }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      const decoded: LoadedImage[] = [];
      const failures: string[] = [];
      await Promise.all(
        files.map(
          (file) =>
            new Promise<void>((resolve) => {
              if (!file.type.startsWith('image/')) {
                failures.push(`${file.name}: not an image`);
                resolve();
                return;
              }
              const url = URL.createObjectURL(file);
              const img = new Image();
              img.onload = () => {
                decoded.push({ image: img, filename: file.name });
                URL.revokeObjectURL(url);
                resolve();
              };
              img.onerror = () => {
                failures.push(`${file.name}: decode failed`);
                URL.revokeObjectURL(url);
                resolve();
              };
              img.src = url;
            })
        )
      );
      if (decoded.length > 0) onImages(decoded);
      if (failures.length > 0) setError(failures.join('; '));
    },
    [onImages]
  );

  if (variant === 'compact') {
    return (
      <label className="uploader uploader--compact">
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            // Reset the input so picking the same file twice in a row still re-fires onChange.
            e.target.value = '';
            if (files.length) loadFiles(files);
          }}
        />
        <span>+ Add region</span>
        {error && <span className="uploader__error">{error}</span>}
      </label>
    );
  }

  return (
    <label
      className={`uploader ${dragOver ? 'uploader--drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length) loadFiles(files);
      }}
    >
      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) loadFiles(files);
        }}
      />
      <span className="uploader__hint">
        Drop images here, or click to choose files
        <small>One or more regional PNGs — Lambert, Mercator, equirectangular, twin hemispheres</small>
      </span>
      {error && <span className="uploader__error">{error}</span>}
    </label>
  );
}
