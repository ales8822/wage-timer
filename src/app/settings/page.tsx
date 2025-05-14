"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WageSettings } from "./components/WageSettings";
import { AllowancesSettings } from "./components/AllowancesSettings";
import { BreaksSettings } from "./components/BreaksSettings";
import { DollarSign, Percent, Coffee } from "lucide-react";

export default function SettingsPage() {
  return (
    <Tabs defaultValue="wage" className="w-full">
      <TabsList className="grid w-full grid-cols-3 mb-6">
        <TabsTrigger value="wage">
          <DollarSign className="mr-2 h-4 w-4 hidden sm:inline-block" />
          Wage
        </TabsTrigger>
        <TabsTrigger value="allowances">
          <Percent className="mr-2 h-4 w-4 hidden sm:inline-block" />
          Allowances
        </TabsTrigger>
        <TabsTrigger value="breaks">
          <Coffee className="mr-2 h-4 w-4 hidden sm:inline-block" />
          Breaks
        </TabsTrigger>
      </TabsList>
      <TabsContent value="wage">
        <WageSettings />
      </TabsContent>
      <TabsContent value="allowances">
        <AllowancesSettings />
      </TabsContent>
      <TabsContent value="breaks">
        <BreaksSettings />
      </TabsContent>
    </Tabs>
  );
}
