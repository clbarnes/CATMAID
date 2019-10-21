# -*- coding: utf-8 -*-

import json
from typing import Dict, List
import yaml

from django import forms
from django.http import HttpResponse, HttpResponseRedirect
from django.db.models import fields as db_fields, ForeignKey
from django.core.exceptions import ValidationError
from django.contrib import admin, messages
from django.contrib.admin.widgets import FilteredSelectMultiple
from django.contrib.auth.admin import UserAdmin, GroupAdmin
from django.contrib.auth.models import User, Group
from django.utils.safestring import mark_safe
from django.utils.translation import ugettext_lazy
from django.urls import reverse
from guardian.admin import GuardedModelAdmin
from catmaid.models import (Project, DataView, Stack, InterpolatableSection,
        ProjectStack, UserProfile, BrokenSlice, StackClassInstance, Relation,
        ClassInstance, Class, StackGroup, StackStackGroup, StackMirror,
        PointCloud, GroupInactivityPeriod, GroupInactivityPeriodContact)
from catmaid.control.importer import importer_admin_view
from catmaid.control.classificationadmin import classification_admin_view
from catmaid.control.annotationadmin import ImportingWizard
from catmaid.control.project import (delete_projects_and_stack_data,
        delete_projects, export_project_data)
from catmaid.views import (UseranalyticsView, UserProficiencyView,
        GroupMembershipHelper)
from catmaid.views.dvid import DVIDImportWizard
from catmaid.views.userimporter import UserImportWizard
from catmaid.views.dataexporter import CatmaidDataExportWizard

def add_related_field_wrapper(form, col_name, rel=None) -> None:
    """Wrap a field on a form so that a little plus sign appears right next to
    it. If clicked a new instance can be added. Expects the form to have the
    admin site instance available in the admin_site field."""
    if not rel:
        rel_model = form.Meta.model
        rel = rel_model._meta.get_field(col_name).remote_field

    form.fields[col_name].widget = admin.widgets.RelatedFieldWidgetWrapper(
        form.fields[col_name].widget, rel, form.admin_site, can_add_related=True)


def duplicate_action(modeladmin, request, queryset) -> None:
    """
    An action that can be added to individual model admin forms to duplicate
    selected entries. Currently, it only duplicates each object without any
    foreign key or many to many relationships.
    """
    for object in queryset:
        object.id = None
        object.save()
duplicate_action.short_description = "Duplicate selected without relations" # type: ignore # https://github.com/python/mypy/issues/2087


def export_project_json_action(modeladmin, request, queryset) -> HttpResponse:
    """An action that will export projects into a JSON file.
    """
    if len(queryset) == 0:
        raise ValueError("No project selected")

    projects = queryset
    result = export_project_data(projects)

    response = HttpResponse(json.dumps(result), content_type='application/json')
    filename = f"catmaid-projects-{'-'.join([str(p.id) for p in projects])}.json"
    response['Content-Disposition'] = f'attachment; filename={filename}'

    return response

export_project_json_action.short_description = "Export projects as JSON file" # type: ignore # https://github.com/python/mypy/issues/2087


def export_project_yaml_action(modeladmin, request, queryset) -> HttpResponse:
    """An action that will export projects into a YAML file.
    """
    if len(queryset) == 0:
        raise ValueError("No project selected")

    projects = queryset
    result = export_project_data(projects)

    response = HttpResponse(yaml.dump(result), content_type='application/yaml')
    filename = f"catmaid-projects-{'-'.join([str(p.id) for p in projects])}.yaml"
    response['Content-Disposition'] = f'attachment; filename={filename}'

    return response

export_project_yaml_action.short_description = "Export projects as YAML file" # type: ignore # https://github.com/python/mypy/issues/2087


def delete_projects_plus_stack_data(modeladmin, request, queryset) -> None:
    """An action that expects a list of projects as queryset that will be
    deleted. All stacks linked with a project_stack relation to those projects
    will be deleted as well along with stack groups that exclusivelt use the
    stacks and broken sections."""
    delete_projects_and_stack_data(queryset)
delete_projects_plus_stack_data.short_description = "Delete selected incl. linked stack data" # type: ignore # https://github.com/python/mypy/issues/2087


def delete_projects_and_data(modeladmin, request, queryset) -> HttpResponseRedirect:
    """An action that expects a list of projects as queryset that will be
    deleted along with all data that reference it (e.g. treenodes, volumes,
    ontologies). A confirmation page will be shown.
    """
    project_ids = list(map(str, queryset.values_list('id', flat=True)))
    return HttpResponseRedirect(reverse("catmaid:delete-projects-with-data") +
            f"?ids={','.join(project_ids)}")
delete_projects_and_data.short_description = "Delete selected" # type: ignore # https://github.com/python/mypy/issues/2087


class BrokenSliceModelForm(forms.ModelForm):
    """ This model form for the BrokenSlide model, will add an optional "last
    index" field. BrokenSliceAdmin will deactivate it, when an existing
    instance is edited. Using it when adding, allows to add many broken slice
    entries at once.
    """
    last_index = forms.IntegerField(initial="",
            required=False, help_text="Optionally, add a last index "
            "and a new broken slice entry will be generated for each "
            "slice in the range [index, last index].")

    class Meta:
        model = BrokenSlice
        fields = '__all__'


class GroupAdminForm(forms.ModelForm):
    """A simple group admin form which adds a user edit control similar to the
    permission control. The base version of this code was available here:
    https://stackoverflow.com/questions/6097210
    """
    users = forms.ModelMultipleChoiceField(
        queryset=User.objects.all(),
        required=False,
        widget=FilteredSelectMultiple(
            verbose_name=ugettext_lazy('Users'),
            is_stacked=False
        )
    )

    class Meta:
        model = Group
        fields = '__all__'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        if self.instance and self.instance.pk:
            self.fields['users'].initial = self.instance.user_set.all()


class BrokenSliceAdmin(GuardedModelAdmin):
    list_display = ('stack', 'index')
    search_fields = ('stack__title', 'index')
    list_editable = ('index',)

    form = BrokenSliceModelForm

    def get_fieldsets(self, request, obj=None):
        """ Remove last_index field if an existing instance is edited.
        """
        fieldsets = super().get_fieldsets(request, obj)
        if obj and 'last_index' in fieldsets[0][1]['fields']:
            fieldsets[0][1]['fields'].remove('last_index')
        return fieldsets

    def save_model(self, request, obj, form, change) -> None:
        """ After calling the super method, additinal broken slice records are
        created if a "last index was specified.
        """
        super().save_model(request, obj, form, change)
        li = (form.cleaned_data.get('last_index'))
        # Only attemt to add additional broken slice entries, if a last index
        # was specified.
        if li and not change:
            s = form.cleaned_data.get('stack')
            i = int(form.cleaned_data.get('index'))
            # Add a new broken slice entry for each additional index, if it
            # doesn't exist already.
            num_extra_slices = max(li - i, 0)
            new_entry_count = 0
            for diff in range(1, num_extra_slices + 1):
                _, created = BrokenSlice.objects.get_or_create(stack=s,
                        index=i+diff)
                if created:
                    new_entry_count += 1

            # Create a result message
            if new_entry_count > 0:
                msg = f'Added {new_entry_count} additional broken slice entries.'
                if num_extra_slices != new_entry_count:
                    msg += f' {num_extra_slices - new_entry_count} broken slice entries were already present.'
                messages.add_message(request, messages.INFO, msg)
            elif num_extra_slices > 0 and new_entry_count == 0:
                msg = f'All {num_extra_slices} extra broken slice entries were already present.'
                messages.add_message(request, messages.INFO, msg)


class InterpolatableSectionAdmin(admin.ModelAdmin):
    list_display = ('project', 'orientation', 'location_coordinate')
    search_fields = ('project', 'orientation', 'location_coordinate')
    list_editable = ('orientation', 'location_coordinate',)

    class Meta:
        model = InterpolatableSection
        fields = '__all__'


class StackMirrorForm(forms.ModelForm):

    class Meta:
        model = StackMirror
        fields = '__all__'
        widgets = {
            'title': forms.TextInput(attrs={'size': 20}),
            'image_base': forms.TextInput(attrs={'size': 50}),
            'file_extension': forms.TextInput(attrs={'size': 5}),
        }


class ProjectStackInline(admin.TabularInline):
    model = ProjectStack
    extra = 1
    max_num = 20
    raw_id_fields = ("stack",)


class StackStackGroupInline(admin.TabularInline):
    model = StackStackGroup
    extra = 1
    max_num = 10
    raw_id_fields = ('stack_group',)
    verbose_name = 'Stack group member'
    verbose_name_plural = 'Stack group members'


class StackMirrorInline(admin.TabularInline):
    model = StackMirror
    form = StackMirrorForm
    extra = 1
    max_num = 10
    verbose_name = 'Stack mirror'
    verbose_name_plural = 'Stack mirrors'


class ProjectAdmin(GuardedModelAdmin):
    list_display = ('title',)
    search_fields = ['title','comment']
    inlines = [ProjectStackInline]
    save_as = True
    actions = (delete_projects_and_data, delete_projects_plus_stack_data,
            duplicate_action, export_project_json_action,
            export_project_yaml_action)

    def get_actions(self, request):
        """Disable default delete action.
        """
        actions = super().get_actions(request)
        if 'delete_selected' in actions:
            del actions['delete_selected']
        return actions


class PointCloudAdmin(GuardedModelAdmin):
    search_fields = ['name','description']
    save_as = True


class StackAdmin(GuardedModelAdmin):
    list_display = ('title', 'dimension', 'resolution',)
    search_fields = ['title', 'comment']
    inlines = [ProjectStackInline, StackStackGroupInline, StackMirrorInline]
    save_as = True
    actions = (duplicate_action,)


class StackGroupAdmin(GuardedModelAdmin):
    list_display = ('title', 'comment')
    search_fields = ['title', 'comment']
    inlines = [StackStackGroupInline]
    save_as = True
    actions = (duplicate_action,)


class ProjectStackAdmin(admin.ModelAdmin):
    list_display = ('id', '__str__', 'project', 'stack', 'orientation', 'translation')
    search_fields = ('id', '__str__', 'project', 'stack', 'orientation')
    list_display_links = ('id', '__str__')
    save_as = True
    actions = (duplicate_action,)


class StackMirrorAdmin(GuardedModelAdmin):
    form = StackMirrorForm
    list_display = ('title', 'stack', 'position', 'image_base')
    search_fields = ['title', 'image_base']
    list_editable = ('position',)
    save_as = True
    actions = (duplicate_action,)

class DataViewConfigWidget(forms.widgets.Textarea):
    def render(self, name, value, attrs=None, renderer=None) -> str:
        output = super().render(name, value, attrs,
                renderer)
        output += "<p id='data_view_config_help' class='help'></p>"
        return mark_safe(output)


class DataViewAdminForm(forms.ModelForm):
    """ As custom validation is needed for a data view's configuration
    field (it must be JSON data), a custom form is needed, too.
    """
    class Meta:
        model = DataView
        fields = '__all__'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Since we want to add additional information to the data view
        # configuration widget, we decorate it
        self.fields['config'].widget = DataViewConfigWidget(
            attrs={'class': 'vLargeTextField'})
        # The positioning should be handled by a choice field
        num_data_views = DataView.objects.count()
        position_choices = ((x, str(x)) for x in range(num_data_views))
        self.fields['position'] = forms.ChoiceField(choices=position_choices)

    def clean_config(self):
        """ Custom validation for tha data view's config field.
        """
        config = self.cleaned_data["config"]
        try:
            import json
            json.loads(config)
        except:
            raise ValidationError("Couldn't parse the configuration as JSON "
                                  "data. See e.g. http://en.wikipedia.org/"
                                  "wiki/JSON for examples.")

        return config


class DataViewAdmin(GuardedModelAdmin):
    list_display = ('title', 'data_view_type', 'position', 'is_default',
                    'comment')
    list_editable = ('position',)
    # Add the custom form which does validation of the view
    # configuration
    form = DataViewAdminForm
    # A custom change form admin view template is needed to display
    # configuraiton information. Since django-guardian is used, which
    # provides a custiom change_form.html template as well, we need
    # to explicitely refer to our wanted template.
    change_form_template = 'catmaid/admin/dataview/change_form.html'
    save_as = True
    actions = (duplicate_action,)


class ProfileInline(admin.StackedInline):
    model = UserProfile
    fk_name = 'user'
    max_num = 1

    def get_formset(self, request, obj=None, **kwargs):
        """ Exclude the color field for non-superusers. It's not important to
        override exactly this method, we just need some method that gets the
        request object.
        """
        if request.user.is_superuser:
            self.exclude = ()
        else:
            self.exclude = ('color',)
        return super().get_formset(request, obj, **kwargs)


class GroupInactivityPeriodContactUserInline(admin.StackedInline):
    model = GroupInactivityPeriodContact
    fk_name = 'user'
    max_num = 1


class GroupInactivityPeriodContactGroupInline(admin.StackedInline):
    model = GroupInactivityPeriodContact
    fk_name = 'inactivity_period'
    max_num = 1


class CustomUserAdmin(UserAdmin):
    inlines = [ProfileInline, GroupInactivityPeriodContactUserInline]
    list_display = ('username', 'email', 'first_name', 'last_name', 'is_staff')
    filter_horizontal = ('groups', 'user_permissions')

    def changelist_view(self, request, extra_context=None):
        """ Add a color column for superusers. It's not important to override
        exactly this method, we just need some method that gets the request
        object.
        """
        if request.user.is_superuser and self.list_display[-1] != 'color':
            self.list_display = self.list_display + ('color',)
        return super().changelist_view(request, extra_context=extra_context)

class CustomGroupAdmin(GroupAdmin):
    form = GroupAdminForm
    list_filter = ('name',)

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if 'users' in form.cleaned_data:
            form.instance.user_set.set(form.cleaned_data['users'])


class GroupInactivityPeriodAdmin(admin.ModelAdmin):
    model = GroupInactivityPeriod
    list_display = ('group', 'max_inactivity', 'message', 'comment')
    list_filter = ('group', 'max_inactivity', 'message', 'comment')
    inlines = [GroupInactivityPeriodContactGroupInline]


def color(self):
    try:
        up = UserProfile.objects.get(user=self)
        return mark_safe('<div style="background-color:%s; border-style:' \
                'inset; border-width:thin; margin-left:1em; width:100px; ' \
                'height:100%%;">&nbsp;</div>' % up.color.hex_color())
    except Exception as e:
        return mark_safe(f'<div>{e}</div>')

color.allow_tags = True # type: ignore # https://github.com/python/mypy/issues/2087
User.color = color

# Add model admin views
admin.site.register(BrokenSlice, BrokenSliceAdmin)
admin.site.register(InterpolatableSection, InterpolatableSectionAdmin)
admin.site.register(Project, ProjectAdmin)
admin.site.register(DataView, DataViewAdmin)
admin.site.register(Stack, StackAdmin)
admin.site.register(StackGroup, StackGroupAdmin)
admin.site.register(ProjectStack, ProjectStackAdmin)
admin.site.register(StackMirror, StackMirrorAdmin)
admin.site.register(PointCloud, PointCloudAdmin)

# Replace the user admin view with custom view
admin.site.register(User, CustomUserAdmin)
admin.site.register(Group, CustomGroupAdmin)
admin.site.register(GroupInactivityPeriod, GroupInactivityPeriodAdmin)
# Register additional views
admin.site.register_view('annotationimporter', 'Import annotations and tracing data',
                         view=ImportingWizard.as_view())
admin.site.register_view('importer', 'Import projects and image stacks',
                         view=importer_admin_view)
admin.site.register_view('useranalytics', 'User Analytics',
                         view=UseranalyticsView.as_view())
admin.site.register_view('userproficiency', 'User Proficiency',
                         view=UserProficiencyView.as_view())
admin.site.register_view('classificationadmin',
                         'Tag Based Classification Graph Linker',
                         view=classification_admin_view)
admin.site.register_view('groupmembershiphelper',
                         'Manage group memberships',
                         urlname='groupmembershiphelper',
                         view=GroupMembershipHelper.as_view())
admin.site.register_view('dvidimporter', 'Import DVID stacks',
                         view=DVIDImportWizard.as_view())
admin.site.register_view('userimporter', 'Import users',
                         view=UserImportWizard.as_view())
admin.site.register_view('catmaiddataexporter', 'CATMAID data export',
                         view=CatmaidDataExportWizard.as_view())
