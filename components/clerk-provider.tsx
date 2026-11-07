import { ClerkProvider as ClerkNextJSProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/themes";

type ClerkProviderProps = React.ComponentProps<typeof ClerkNextJSProvider>;

// Clerk's forms follow the admin: white surface, black text and buttons,
// hairline borders, no shadows.
export function ClerkProvider({ children, appearance, ...props }: ClerkProviderProps) {
  return (
    <ClerkNextJSProvider
      appearance={{
        theme: shadcn,
        variables: {
          colorPrimary: "#000000",
          colorText: "#000000",
          colorBackground: "#ffffff",
          borderRadius: "0.75rem",
          fontFamily: "var(--font-inter), system-ui, sans-serif",
        },
        elements: {
          cardBox: "shadow-none border border-black/10 rounded-3xl",
          footer: "bg-white",
        },
        ...appearance,
      }}
      {...props}
    >
      {children}
    </ClerkNextJSProvider>
  );
}
