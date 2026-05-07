import {
  Alert,
  Button,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import CloseIcon from "@mui/icons-material/Close";
import type { AdminResource } from "@skate-route-mapper/shared/adminResources";
import { componentStyles, space } from "@skate-route-mapper/shared/design";
import { useState } from "react";
import type { FormEvent } from "react";
import { controlRadiusPx, px, radiusLevel } from "../../theme/adminTheme";
import type { RadiusLevel } from "../../theme/adminTheme";
import type { EntityPayload, EntityRecord } from "../../types";
import { buildInitialFormState, buildPayload, inputType } from "./entityFormUtils";

export function EntityForm({
  controlLevel = radiusLevel.embedded,
  mode,
  onCancel,
  onSubmit,
  record,
  resource,
}: {
  controlLevel?: RadiusLevel;
  mode: "create" | "edit";
  onCancel?: () => void;
  onSubmit: (payload: EntityPayload) => Promise<void>;
  record?: EntityRecord;
  resource: AdminResource;
}) {
  const [formState, setFormState] = useState(() => buildInitialFormState(resource, mode, record));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fields = resource.fields.filter((field) => (mode === "create" ? field.create : field.edit));
  const controlSx = {
    "& .MuiOutlinedInput-root": {
      borderRadius: controlRadiusPx(controlLevel),
    },
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onSubmit(buildPayload(resource, formState, mode));

      if (mode === "create") {
        setFormState(buildInitialFormState(resource, mode));
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Save failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Stack component="form" onSubmit={handleSubmit} spacing={2}>
      <Stack
        direction={{ xs: "column", lg: "row" }}
        sx={{
          flexWrap: "wrap",
          gap: px(space.lg),
          "& > *": { flex: "1 1 220px" },
        }}
      >
        {fields.map((field) => {
          if (field.type === "boolean") {
            return (
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(formState[field.name])}
                    onChange={(event) => setFormState((current) => ({
                      ...current,
                      [field.name]: event.target.checked,
                    }))}
                  />
                }
                key={field.name}
                label={field.label}
                sx={{
                  alignItems: "center",
                  bgcolor: "background.paper",
                  borderRadius: controlRadiusPx(controlLevel),
                  m: 0,
                  minHeight: componentStyles.primaryButton.minHeight,
                  px: px(space.md),
                }}
              />
            );
          }

          if (field.type === "enum") {
            return (
              <FormControl key={field.name} required={field.required} size="small" sx={controlSx}>
                <InputLabel>{field.label}</InputLabel>
                <Select
                  label={field.label}
                  onChange={(event: SelectChangeEvent) => setFormState((current) => ({
                    ...current,
                    [field.name]: event.target.value,
                  }))}
                  value={String(formState[field.name] ?? "")}
                >
                  {field.options?.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            );
          }

          const slotProps = field.type === "datetime" ? { inputLabel: { shrink: true } } : undefined;

          return (
            <TextField
              autoComplete={field.type === "password" ? "new-password" : undefined}
              key={field.name}
              label={field.label}
              onChange={(event) => setFormState((current) => ({
                ...current,
                [field.name]: event.target.value,
              }))}
              required={field.required && !(mode === "edit" && field.type === "password")}
              slotProps={slotProps}
              type={inputType(field.type)}
              value={String(formState[field.name] ?? "")}
              sx={controlSx}
            />
          );
        })}
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
        {onCancel ? (
          <Button
            onClick={onCancel}
            startIcon={<CloseIcon />}
            sx={{ borderRadius: controlRadiusPx(controlLevel) }}
            variant="outlined"
          >
            Cancel
          </Button>
        ) : null}
        <Button
          disabled={isSubmitting}
          startIcon={<SaveIcon />}
          sx={{ borderRadius: controlRadiusPx(controlLevel) }}
          type="submit"
          variant="contained"
        >
          {isSubmitting ? "Saving..." : mode === "create" ? "Create" : "Save"}
        </Button>
      </Stack>
    </Stack>
  );
}
