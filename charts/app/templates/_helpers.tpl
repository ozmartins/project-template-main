{{/*
Expand the name of the chart.
*/}}
{{- define "app.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "app.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "app.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "app.labels" -}}
helm.sh/chart: {{ include "app.chart" . }}
{{ include "app.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Base selector labels (release + chart name).
*/}}
{{- define "app.selectorLabels" -}}
app.kubernetes.io/name: {{ include "app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Frontend fully-qualified name.
*/}}
{{- define "app.frontend.fullname" -}}
{{- printf "%s-frontend" (include "app.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Frontend selector labels.
*/}}
{{- define "app.frontend.selectorLabels" -}}
app.kubernetes.io/name: {{ printf "%s-frontend" (include "app.name" .) | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Temporal-worker fully-qualified name.
*/}}
{{- define "app.temporalWorker.fullname" -}}
{{- printf "%s-temporal-worker" (include "app.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Temporal-worker selector labels.
*/}}
{{- define "app.temporalWorker.selectorLabels" -}}
app.kubernetes.io/name: {{ printf "%s-temporal-worker" (include "app.name" .) | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Ops-api fully-qualified name.
*/}}
{{- define "app.opsApi.fullname" -}}
{{- printf "%s-ops-api" (include "app.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Ops-api selector labels.
*/}}
{{- define "app.opsApi.selectorLabels" -}}
app.kubernetes.io/name: {{ printf "%s-ops-api" (include "app.name" .) | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Return the fully-qualified image reference for a component.
  Usage: {{ include "app.image" (dict "image" .Values.frontend.image "global" .Values.imageRegistry) }}
When image.digest is set the reference uses repo@sha256:… (digest pins are immutable).
When image.digest is empty the reference falls back to repo:tag.
*/}}
{{- define "app.image" -}}
{{- $registry := .image.registry | default .global -}}
{{- $repo := .image.repository -}}
{{- $ref := printf "%s/%s" $registry $repo -}}
{{- if not $registry -}}
{{- $ref = $repo -}}
{{- end -}}
{{- if .image.digest -}}
{{- printf "%s@%s" $ref .image.digest -}}
{{- else -}}
{{- printf "%s:%s" $ref .image.tag -}}
{{- end -}}
{{- end }}
