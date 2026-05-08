import { useCallback, useState } from 'react';

interface Props {
  onImage: (img: HTMLImageElement, name: string) => void;
}

export function Uploader({ onImage }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFile = useCallback(
    (file: File) => {
      setError(null);
      if (!file.type.startsWith('image/')) {
        setError(`Not an image: ${file.type || 'unknown'}`);
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        onImage(img, file.name);
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        setError('Failed to decode image');
        URL.revokeObjectURL(url);
      };
      img.src = url;
    },
    [onImage]
  );

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
        const file = e.dataTransfer.files?.[0];
        if (file) loadFile(file);
      }}
    >
      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) loadFile(file);
        }}
      />
      <span className="uploader__hint">
        Drop an image here, or click to choose a file
        <small>PNG, JPG — equirectangular (2:1) or Mercator (1:1)</small>
      </span>
      {error && <span className="uploader__error">{error}</span>}
    </label>
  );
}
