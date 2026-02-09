import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { CityProvider } from "@/lib/city-context";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import TripPage from "@/pages/trip";
import Preferences from "@/pages/preferences";
import History from "@/pages/history";
import Packages from "@/pages/packages";
import Account from "@/pages/account";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/trip/:id" component={TripPage} />
      <Route path="/preferences" component={Preferences} />
      <Route path="/history" component={History} />
      <Route path="/packages" component={Packages} />
      <Route path="/account" component={Account} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CityProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </CityProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
