import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeModeProvider } from "../helpers/themeMode";
import { TooltipProvider } from "./Tooltip";
import { SonnerToaster } from "./SonnerToaster";
import { ScrollToHashElement } from "./ScrollToHashElement";
import { AuthProvider } from "../helpers/useAuth";
import { ConnectionProvider } from "../helpers/useConnection";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute “fresh” window
    },
  },
});

export const GlobalContextProviders = ({
  children,
}: {
  children: ReactNode;
}) => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <ScrollToHashElement />
        <AuthProvider>
          <ConnectionProvider>
            <TooltipProvider>
              {children}
              <SonnerToaster />
            </TooltipProvider>
          </ConnectionProvider>
        </AuthProvider>
      </ThemeModeProvider>
    </QueryClientProvider>
  );
};
