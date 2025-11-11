import { useState, useRef, useEffect } from 'react';
import './MultiSelectAutocomplete.css';

interface MultiSelectAutocompleteProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  label?: string;
}

export default function MultiSelectAutocomplete({
  options,
  selected,
  onChange,
  placeholder = 'Search...',
  label,
}: MultiSelectAutocompleteProps) {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter options based on input and exclude already selected
  const filteredOptions = options
    .filter(option => !selected.includes(option))
    .filter(option => option.toLowerCase().includes(inputValue.toLowerCase()))
    .sort();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset highlighted index when filtered options change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [inputValue]);

  function handleInputChange(value: string) {
    setInputValue(value);
    setIsOpen(true);
  }

  function handleOptionClick(option: string) {
    onChange([...selected, option]);
    setInputValue('');
    setHighlightedIndex(0);
    inputRef.current?.focus();
  }

  function handleRemove(option: string) {
    onChange(selected.filter(item => item !== option));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen && e.key !== 'Escape') {
      setIsOpen(true);
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev =>
          prev < filteredOptions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredOptions[highlightedIndex]) {
          handleOptionClick(filteredOptions[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setInputValue('');
        break;
      case 'Backspace':
        if (inputValue === '' && selected.length > 0) {
          e.preventDefault();
          onChange(selected.slice(0, -1));
        }
        break;
    }
  }

  function handleInputFocus() {
    setIsOpen(true);
  }

  return (
    <div className="multi-select-wrapper" ref={wrapperRef}>
      {label && <label className="multi-select-label">{label}</label>}

      <div className="multi-select-container">
        <div className="multi-select-selected">
          {selected.map(item => (
            <span key={item} className="multi-select-tag">
              {item}
              <button
                type="button"
                onClick={() => handleRemove(item)}
                className="multi-select-tag-remove"
                aria-label={`Remove ${item}`}
              >
                ×
              </button>
            </span>
          ))}

          <input
            ref={inputRef}
            type="text"
            className="multi-select-input"
            value={inputValue}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            placeholder={selected.length === 0 ? placeholder : ''}
          />
        </div>

        {isOpen && filteredOptions.length > 0 && (
          <ul className="multi-select-dropdown">
            {filteredOptions.slice(0, 100).map((option, index) => (
              <li
                key={option}
                className={`multi-select-option ${
                  index === highlightedIndex ? 'highlighted' : ''
                }`}
                onClick={() => handleOptionClick(option)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                {option}
              </li>
            ))}
            {filteredOptions.length > 100 && (
              <li className="multi-select-option-count">
                + {filteredOptions.length - 100} more (keep typing to narrow down)
              </li>
            )}
          </ul>
        )}
      </div>

      {selected.length > 0 && (
        <div className="multi-select-count">
          {selected.length} selected
        </div>
      )}
    </div>
  );
}
