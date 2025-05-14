"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useSettings } from "@/contexts/SettingsContext";
import { useToast } from "@/hooks/use-toast";
import type { DayOfWeek, HourlyAllowance } from "@/types";
import { ALL_DAYS } from "@/types";
import { Trash2, PlusCircle } from "lucide-react";
import { useEffect } from "react";

const dayAllowanceSchema = z.object({
  percentage: z.coerce.number().min(0, "Percentage must be non-negative").max(500, "Percentage seems too high"),
});

const dayAllowancesSchema = z.object({
  allowances: z.record(z.string(), dayAllowanceSchema) // Using day name as key
});

type DayAllowancesFormValues = z.infer<typeof dayAllowancesSchema>;


const hourlyAllowanceSchema = z.object({
  id: z.string().optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid start time (HH:MM)"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid end time (HH:MM)"),
  percentage: z.coerce.number().min(0, "Bonus must be non-negative").max(200, "Bonus percentage seems too high"),
});

const hourlyAllowancesSchema = z.object({
  hourly_allowances: z.array(hourlyAllowanceSchema)
}).refine(data => { // Custom validation for time overlap can be complex, keeping it simple here.
  for (const allowance of data.hourly_allowances) {
    if (allowance.startTime >= allowance.endTime) {
      // This basic check doesn't handle midnight crossing.
      // For more robust validation, one might need a library or more complex logic.
      return false; 
    }
  }
  return true;
}, {
  message: "End time must be after start time for all hourly allowances.",
  path: ["hourly_allowances"], // General path, could be more specific if needed
});


type HourlyAllowancesFormValues = z.infer<typeof hourlyAllowancesSchema>;


export function AllowancesSettings() {
  const { settings, updateDayAllowances, addHourlyAllowance, updateHourlyAllowance, removeHourlyAllowance, isLoading } = useSettings();
  const { toast } = useToast();

  const dayForm = useForm<DayAllowancesFormValues>({
    resolver: zodResolver(dayAllowancesSchema),
    defaultValues: {
      allowances: ALL_DAYS.reduce((acc, day) => {
        acc[day] = { percentage: settings.dayAllowances[day] || 100 };
        return acc;
      }, {} as Record<DayOfWeek, {percentage: number}>),
    },
  });

  const hourlyForm = useForm<HourlyAllowancesFormValues>({
    resolver: zodResolver(hourlyAllowancesSchema),
    defaultValues: {
        hourly_allowances: settings.hourlyAllowances
    }
  });

  const { fields, append, remove, update } = useFieldArray({
    control: hourlyForm.control,
    name: "hourly_allowances",
  });

  useEffect(() => {
    if (!isLoading) {
      dayForm.reset({
        allowances: ALL_DAYS.reduce((acc, day) => {
          acc[day] = { percentage: settings.dayAllowances[day] || 100 };
          return acc;
        }, {} as Record<DayOfWeek, {percentage: number}>),
      });
      hourlyForm.reset({ hourly_allowances: settings.hourlyAllowances });
    }
  }, [settings, isLoading, dayForm, hourlyForm]);


  const onDaySubmit = (data: DayAllowancesFormValues) => {
    const newDayAllowances = ALL_DAYS.reduce((acc, day) => {
      acc[day] = data.allowances[day].percentage;
      return acc;
    }, {} as Record<DayOfWeek, number>);
    updateDayAllowances(newDayAllowances);
    toast({
      title: "Settings Saved",
      description: "Day allowances have been updated.",
    });
    dayForm.reset(data); // To reset dirty state
  };

  const onHourlySubmit = (data: HourlyAllowancesFormValues) => {
    // This is tricky with useFieldArray. We need to map and call context functions.
    // For simplicity, let's assume we are replacing all hourly allowances.
    // A more granular approach would compare and call add/update/remove individually.
    const newAllowances: HourlyAllowance[] = data.hourly_allowances.map(ha => ({
        id: ha.id || Date.now().toString(), // Assign new ID if not present
        startTime: ha.startTime,
        endTime: ha.endTime,
        percentage: ha.percentage,
    }));
    
    // Replace all hourly allowances
    settings.hourlyAllowances.forEach(ha => removeHourlyAllowance(ha.id));
    newAllowances.forEach(ha => addHourlyAllowance(ha));
    
    toast({
      title: "Settings Saved",
      description: "Hourly allowances have been updated.",
    });
    hourlyForm.reset({ hourly_allowances: newAllowances }); // Reset with potentially new IDs
  };

  if (isLoading) return <p>Loading allowances settings...</p>;

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Day Allowances</CardTitle>
          <CardDescription>Set different wage percentages for each day of the week. This is the total multiplier (e.g., 200% for double pay).</CardDescription>
        </CardHeader>
        <Form {...dayForm}>
          <form onSubmit={dayForm.handleSubmit(onDaySubmit)}>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {ALL_DAYS.map((day) => (
                  <FormField
                    key={day}
                    control={dayForm.control}
                    name={`allowances.${day}.percentage`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{day}</FormLabel>
                        <FormControl>
                          <div className="flex items-center">
                            <Input type="number" placeholder="100" {...field} className="mr-2" /> %
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
               <FormDescription>
                Note: Day allowances and hourly allowances combine additively. E.g., if Sunday is 200% and an active hourly allowance is +25%, the effective rate is Base Wage * (200% + 25%) = Base Wage * 2.25.
              </FormDescription>
            </CardContent>
            <CardFooter className="border-t px-6 py-4">
              <Button type="submit" disabled={dayForm.formState.isSubmitting || !dayForm.formState.isDirty}>Save Day Allowances</Button>
              {dayForm.formState.isDirty && (
                <Button type="button" variant="ghost" onClick={() => dayForm.reset()} className="ml-2">
                  Cancel
                </Button>
              )}
            </CardFooter>
          </form>
        </Form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hourly Allowances</CardTitle>
          <CardDescription>Set different wage percentage bonuses for specific time periods. This bonus is added to the day's rate.</CardDescription>
        </CardHeader>
        <Form {...hourlyForm}>
          <form onSubmit={hourlyForm.handleSubmit(onHourlySubmit)}>
            <CardContent className="space-y-6">
              {fields.map((item, index) => (
                <div key={item.id} className="p-4 border rounded-md space-y-3 relative">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
                    <FormField
                      control={hourlyForm.control}
                      name={`hourly_allowances.${index}.startTime`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Start Time</FormLabel>
                          <Input type="time" {...field} />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={hourlyForm.control}
                      name={`hourly_allowances.${index}.endTime`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>End Time</FormLabel>
                          <Input type="time" {...field} />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={hourlyForm.control}
                      name={`hourly_allowances.${index}.percentage`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bonus %</FormLabel>
                           <div className="flex items-center">
                            <Input type="number" placeholder="25" {...field} className="mr-2" /> %
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                     <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="text-destructive hover:text-destructive-foreground hover:bg-destructive md:self-center">
                        <Trash2 className="h-5 w-5" />
                        <span className="sr-only">Remove Allowance</span>
                      </Button>
                  </div>
                   {hourlyForm.formState.errors.hourly_allowances?.[index]?.root?.message && (
                    <p className="text-sm font-medium text-destructive">
                      {hourlyForm.formState.errors.hourly_allowances[index]?.root?.message}
                    </p>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ startTime: "18:00", endTime: "22:00", percentage: 25 })}
                className="mt-2"
              >
                <PlusCircle className="mr-2 h-4 w-4" /> Add Hourly Allowance
              </Button>
            </CardContent>
            <CardFooter className="border-t px-6 py-4">
              <Button type="submit" disabled={hourlyForm.formState.isSubmitting || !hourlyForm.formState.isDirty}>Save Hourly Allowances</Button>
               {hourlyForm.formState.isDirty && (
                <Button type="button" variant="ghost" onClick={() => hourlyForm.reset()} className="ml-2">
                  Cancel
                </Button>
              )}
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
