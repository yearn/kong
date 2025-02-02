"use client";

import {
  CellMeasurer,
  CellMeasurerCache,
  List,
  ListRowProps,
} from "react-virtualized";
import { useIndexingErrors } from "./useIndexingError";

export default function IndexingErrors() {
  const { errors, isLoading, isError } = useIndexingErrors();
  const cache = new CellMeasurerCache({
    fixedWidth: true,
    defaultHeight: 100,
  });

  if (isLoading) return <div>Loading...</div>;
  if (isError) return <div>Error</div>;

  function rowRenderer({ index, key, parent, style }: ListRowProps) {
    const error = errors[index];
    return (
      <CellMeasurer
        cache={cache}
        columnIndex={0}
        key={key}
        rowIndex={index}
        parent={parent}
      >
        {({ measure, registerChild }) => (
          <div
            ref={registerChild}
            style={style}
            className="whitespace-pre-wrap word-wrap break-word border-b border-yellow-700 p-2"
            onLoad={measure}
          >
            {error.stacktrace}
          </div>
        )}
      </CellMeasurer>
    );
  }

  return (
    <div className={"w-full flex flex-col gap-2 text-yellow-700"}>
      <div className="font-bold text-xl">Latest Errors</div>
      <List
        className="scrollbar scrollbar-thumb-yellow-700"
        height={800}
        itemCount={errors.length}
        itemSize={cache.rowHeight}
        width={500}
        rowRenderer={rowRenderer}
        rowHeight={cache.rowHeight}
        rowCount={errors.length}
      />
    </div>
  );
}
