import { ComboBox, Description, Input, Label, ListBox } from "@heroui/react";
import type { SelectFieldOption } from "./SelectField.tsx";

const EMPTY_VALUE = "__kitten_empty_value__";

interface SearchableOption extends SelectFieldOption {
  readonly id: string;
}

interface SearchableSelectFieldProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectFieldOption[];
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly description?: string;
  readonly placeholder?: string;
  readonly emptyMessage?: string;
}

function optionId(value: string): string {
  return value.length === 0 ? EMPTY_VALUE : value;
}

export function SearchableSelectField({
  label,
  value,
  options,
  onChange,
  disabled = false,
  description,
  placeholder = "Search options",
  emptyMessage = "No matching options",
}: SearchableSelectFieldProps) {
  const items: readonly SearchableOption[] = options.map((option) => ({
    ...option,
    id: optionId(option.value),
  }));

  return (
    <ComboBox<SearchableOption>
      className="field"
      defaultItems={items}
      selectedKey={value.length === 0 ? null : value}
      onSelectionChange={(key) => onChange(String(key) === EMPTY_VALUE ? "" : String(key))}
      defaultFilter={(textValue, inputValue) => (
        textValue.toLocaleLowerCase().includes(inputValue.trim().toLocaleLowerCase())
      )}
      isDisabled={disabled}
      allowsCustomValue={false}
      allowsEmptyCollection
      menuTrigger="focus"
      variant="secondary"
    >
      <Label>{label}</Label>
      <ComboBox.InputGroup>
        <Input placeholder={placeholder} />
        <ComboBox.Trigger aria-label={`Show ${label} options`} />
      </ComboBox.InputGroup>
      {description === undefined ? null : <Description>{description}</Description>}
      <ComboBox.Popover>
        <ListBox<SearchableOption>
          renderEmptyState={() => <p className="m-0 p-3 text-xs leading-5 text-muted">{emptyMessage}</p>}
        >
          {(option) => (
            <ListBox.Item
              id={option.id}
              textValue={option.label}
              isDisabled={option.disabled}
            >
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          )}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  );
}
