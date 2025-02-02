import useSWR from "swr";

const fetcher = async () => {
  const response = await fetch("/api/errors");
  return response.json();
};

export const useIndexingErrors = () => {
  const { data, error, isLoading } = useSWR("/api/mq/errors", fetcher, {
    refreshInterval: 5000,
  });
  return {
    errors: data,
    isLoading,
    isError: error,
  };
};
