import { createTheme } from "@mantine/core";

export const theme = createTheme({
  primaryColor: "indigo",
  defaultRadius: "md",

  fontFamily:
    'system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif',
  headings: {
    fontFamily:
      'system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif',
    fontWeight: "650",
  },

  shadows: {
    xs: "0 1px 2px rgba(0,0,0,.06)",
    sm: "0 2px 10px rgba(0,0,0,.08)",
    md: "0 10px 30px rgba(0,0,0,.12)",
    lg: "0 18px 50px rgba(0,0,0,.16)",
    xl: "0 24px 70px rgba(0,0,0,.18)",
  },

  components: {
    Button: {
      defaultProps: {
        radius: "md",
      },
    },
    ActionIcon: {
      defaultProps: {
        radius: "md",
      },
    },
    Card: {
      defaultProps: {
        radius: "md",
        withBorder: true,
        shadow: "xs",
      },
    },
    Paper: {
      defaultProps: {
        radius: "md",
        withBorder: true,
        shadow: "xs",
      },
    },
    Drawer: {
      defaultProps: {
        radius: "md",
        offset: 10,
      },
    },
    Modal: {
      defaultProps: {
        radius: "md",
        centered: true,
      },
    },
    Badge: {
      defaultProps: {
        radius: "sm",
        variant: "light",
      },
    },
  },
});
