import { useState, useRef, useEffect } from 'react'

export default function AutocompleteInput({
  value,
  onChange,
  suggestions,
  onSelect,
  placeholder,
  className,
  type = 'text',
  rows,
}) {
  const [show, setShow] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef(null)

  const filtered = value.trim()
    ? suggestions.filter(s => s.name.toLowerCase().includes(value.toLowerCase()))
    : []

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShow(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleKeyDown = (e) => {
    if (!show || filtered.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(prev => (prev + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(prev => (prev - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0) {
        e.preventDefault()
        onSelect(filtered[activeIndex])
        setShow(false)
      }
    } else if (e.key === 'Escape') {
      setShow(false)
    }
  }

  const InputTag = rows ? 'textarea' : 'input'

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <InputTag
        type={type}
        rows={rows}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setShow(true)
          setActiveIndex(-1)
        }}
        onFocus={() => setShow(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {show && filtered.length > 0 && (
        <div className="suggestions-list">
          {filtered.map((s, i) => (
            <div
              key={i}
              className={`suggestion-item ${i === activeIndex ? 'active' : ''}`}
              onClick={() => {
                onSelect(s)
                setShow(false)
              }}
            >
              <div className="suggestion-name">{s.name}</div>
              <div className="suggestion-meta">
                {s.protein && <span>{s.protein}g protein</span>}
                {s.calories && <span> · {s.calories} kcal</span>}
                {s.calcium && <span> · {s.calcium}mg Ca</span>}
                {s.veg && <span> · {s.veg} veg</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
