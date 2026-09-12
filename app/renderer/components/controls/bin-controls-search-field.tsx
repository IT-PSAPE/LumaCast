import { Search as SearchIcon } from 'lucide-react';
import { FieldIcon, FieldInput } from '../form/field';
import { useBinControls } from './bin-controls-context';

export function BinControlsSearchField() {
  const { state, actions, meta } = useBinControls();
  return (
    <FieldInput
      value={state.searchValue}
      onChange={actions.onSearchChange}
      placeholder={meta.searchPlaceholder}
      ariaLabel="Search"
      wrapperClassName="h-6 min-h-6 px-1.5 focus-within:bg-tertiary/60"
      iconClassName="ml-0 mr-1.5 size-auto"
      inputClassName="p-0 placeholder:text-tertiary"
    >
      <FieldIcon>
        <SearchIcon size={12} strokeWidth={1.75} className="shrink-0 text-tertiary" />
      </FieldIcon>
    </FieldInput>
  );
}
