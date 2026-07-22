import { Description, Label, ListBox, Select } from "@heroui/react";

const EMPTY_VALUE = "__kitten_empty_value__";

export interface SelectFieldOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

interface SelectFieldProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectFieldOption[];
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly description?: string;
  readonly ariaLabel?: string;
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled = false,
  description,
  ariaLabel,
}: SelectFieldProps) {
  return (
    <Select
      className="field"
      selectedKey={value.length === 0 ? EMPTY_VALUE : value}
      onSelectionChange={(key) => onChange(String(key) === EMPTY_VALUE ? "" : String(key))}
      isDisabled={disabled}
      aria-label={ariaLabel}
      variant="secondary"
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      {description === undefined ? null : <Description>{description}</Description>}
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={option.value.length === 0 ? EMPTY_VALUE : option.value}
              id={option.value.length === 0 ? EMPTY_VALUE : option.value}
              textValue={option.label}
              isDisabled={option.disabled}
            >
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
