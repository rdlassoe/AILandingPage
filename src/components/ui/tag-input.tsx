'use client';

import { useState, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Entrada de lista. Evita pedir al usuario que escriba separado por comas y
 * mantiene el valor como array, que es como viaja al dominio.
 */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  suggestions = [],
  max = 20,
  className,
}: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  max?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const entry = raw.trim();
    if (!entry || value.length >= max) return;
    if (value.some((item) => item.toLowerCase() === entry.toLowerCase())) return;
    onChange([...value, entry]);
    setDraft('');
  };

  const remove = (index: number) => {
    onChange(value.filter((_, position) => position !== index));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(draft);
      return;
    }
    if (event.key === 'Backspace' && draft.length === 0 && value.length > 0) {
      remove(value.length - 1);
    }
  };

  const available = suggestions.filter(
    (suggestion) => !value.some((item) => item.toLowerCase() === suggestion.toLowerCase()),
  );

  return (
    <div className={cn('grid gap-2', className)}>
      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={value.length >= max}
          className="h-9 w-full border border-line-strong bg-panel px-2.5 text-sm text-ink placeholder:text-faint focus:border-accent"
        />
        <button
          type="button"
          onClick={() => add(draft)}
          disabled={draft.trim().length === 0 || value.length >= max}
          className="inline-flex h-9 flex-none items-center gap-1 border border-line-strong px-2.5 text-sm text-muted hover:bg-panel-2 hover:text-ink disabled:opacity-40"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Anadir
        </button>
      </div>

      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((item, index) => (
            <li key={`${item}-${index}`}>
              <span className="inline-flex items-center gap-1 border border-line-strong bg-panel-2 py-0.5 pl-2 pr-1 text-xs text-ink">
                {item}
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="inline-flex size-4 items-center justify-center text-faint hover:text-danger"
                >
                  <X className="size-3" aria-hidden="true" />
                  <span className="sr-only">Quitar {item}</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {available.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-faint">Sugerencias:</span>
          {available.slice(0, 8).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => add(suggestion)}
              className="border border-dashed border-line-strong px-1.5 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
