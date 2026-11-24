import { Select } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';

type Option = {value: string; label: string};
type Props = {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  className?: string;
  wide?: boolean;
};

// A shared menu keeps all selectors sized, positioned and keyboard accessible.
export function SelectField({label, value, options, onChange, className = '', wide = false}: Props) {
  return <Select.Root items={options} value={value} onValueChange={next => {if (next !== null) onChange(next);}}>
    <Select.Trigger className={`select-trigger ${className}`} aria-label={label}>
      <Select.Value className="select-value" />
      <Select.Icon className="select-icon"><ChevronDown size={13} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Positioner className="select-positioner" align="start" sideOffset={6} collisionPadding={12} alignItemWithTrigger={false}>
        <Select.Popup className={`select-popup ${wide ? 'select-popup-wide' : ''}`}>
          <Select.List className="select-list">
            {options.map(option => <Select.Item key={option.value} value={option.value} className="select-option">
              <Select.ItemText>{option.label}</Select.ItemText>
              <Select.ItemIndicator className="select-check"><Check size={13} /></Select.ItemIndicator>
            </Select.Item>)}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>;
}
