"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useSettings } from "@/contexts/SettingsContext";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";

const wageSettingsSchema = z.object({
  baseWage: z.coerce.number().min(0, "Base wage must be non-negative.").max(10000, "Base wage seems too high."),
});

type WageSettingsFormValues = z.infer<typeof wageSettingsSchema>;

export function WageSettings() {
  const { settings, updateBaseWage, isLoading } = useSettings();
  const { toast } = useToast();

  const form = useForm<WageSettingsFormValues>({
    resolver: zodResolver(wageSettingsSchema),
    defaultValues: {
      baseWage: settings.baseWage,
    },
  });

  useEffect(() => {
    if (!isLoading) {
      form.reset({ baseWage: settings.baseWage });
    }
  }, [settings.baseWage, isLoading, form]);


  const onSubmit = (data: WageSettingsFormValues) => {
    updateBaseWage(data.baseWage);
    toast({
      title: "Settings Saved",
      description: "Base wage settings have been updated.",
    });
  };

  if (isLoading) return <p>Loading wage settings...</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Base Wage Settings</CardTitle>
        <CardDescription>Configure your standard hourly wage.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent>
            <FormField
              control={form.control}
              name="baseWage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hourly Wage (€)</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="e.g., 15.50" {...field} step="0.01" />
                  </FormControl>
                  <FormDescription>
                    Enter your gross hourly wage before any allowances.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="border-t px-6 py-4">
            <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
              Save Changes
            </Button>
             {form.formState.isDirty && (
                <Button type="button" variant="ghost" onClick={() => form.reset({ baseWage: settings.baseWage })} className="ml-2">
                  Cancel
                </Button>
            )}
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
