# -*- coding: utf-8 -*-
from __future__ import unicode_literals

import json

from django.http import HttpResponse

from catmaid.models import UserRole, ClassInstanceClassInstance
from catmaid.control.authentication import requires_user_role

try:
    import networkx as nx
    from networkx.readwrite import json_graph
except ImportError:
    pass

def get_annotation_graph(project_id=None):
    qs = ClassInstanceClassInstance.objects.filter(
        relation__relation_name__in=['part_of', 'model_of'],
        project=project_id,
        class_instance_a__class_column__class_name__in=["group", "neuron", "skeleton"],
        class_instance_b__class_column__class_name__in=["root", "group", "neuron", "skeleton"],
    ).select_related("class_instance_a", "class_instance_b", "relation",
        "class_instance_a__class_column", "class_instance_b__class_column")
    g=nx.DiGraph()
    for e in qs:
        if not e.class_instance_a.id in g:
            g.add_node( e.class_instance_a.id, {"class": e.class_instance_a.class_column.class_name,
                                                "name": e.class_instance_a.name} )
        if not e.class_instance_b.id in g:
            g.add_node( e.class_instance_b.id, {"class": e.class_instance_b.class_column.class_name,
                                                "name": e.class_instance_b.name} )
        g.add_edge( e.class_instance_b.id, e.class_instance_a.id,
                { "edge_type": e.relation.relation_name }
        ) # the part_of/model_of edge
    return g


@requires_user_role([UserRole.Annotate, UserRole.Browse])
def convert_annotations_to_networkx(request, project_id=None):
    g = get_annotation_graph( project_id )
    data = json_graph.node_link_data(g)
    json_return = json.dumps(data, sort_keys=True, indent=4)
    return HttpResponse(json_return, content_type='application/json')