import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-l-4 group-[.toaster]:border-border group-[.toaster]:shadow-xl group-[.toaster]:shadow-black/30 group-[.toaster]:backdrop-blur-xl group-[.toaster]:rounded-xl",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success:
            "group-[.toaster]:!border-l-[hsl(263_70%_66%)]",
          error:
            "group-[.toaster]:!border-l-[hsl(0_84%_60%)]",
          info:
            "group-[.toaster]:!border-l-[hsl(187_94%_43%)]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
