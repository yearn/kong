"use client";

import useSWR from "swr";
import {
  CellMeasurer,
  CellMeasurerCache,
  List,
  ListRowProps,
} from "react-virtualized";

const fetcher = async () => {
  const response = await fetch("/api/errors");
  return response.json();
};

const useIndexingErrors = () => {
  const { data, error, isLoading } = useSWR("/api/mq/errors", fetcher);
  return {
    errors: data,
    isLoading,
    isError: error,
  };
};

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
            style={{
              ...style,
              whiteSpace: "pre-wrap",
              wordWrap: "break-word",
              overflowWrap: "break-word",
              borderBottom: "1px solid #333",
              padding: "8px",
            }}
            onLoad={measure}
          >
            {error.stacktrace}
          </div>
        )}
      </CellMeasurer>
    );
  }

  return (
    <List
      height={800}
      itemCount={errors.length}
      itemSize={cache.rowHeight}
      width={500}
      rowRenderer={rowRenderer}
      rowHeight={cache.rowHeight}
      rowCount={errors.length}
    />
  );
}
