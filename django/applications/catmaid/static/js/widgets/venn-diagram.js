/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */
/* global
  InstanceRegistry
*/

(function(CATMAID) {

  "use strict";

  var VennDiagram = function() {
    this.widgetID = this.registerInstance();
    CATMAID.SkeletonSource.call(this, true);

    this.groups = [];
    this.selected = {}; // skid vs model
  };

  VennDiagram.prototype = Object.create(CATMAID.SkeletonSource.prototype);
  VennDiagram.prototype.constructor = VennDiagram;

  $.extend(VennDiagram.prototype, new InstanceRegistry());

  VennDiagram.prototype.getName = function() {
    return "Venn Diagram " + this.widgetID;
  };

  VennDiagram.prototype.getWidgetConfiguration = function() {
    return {
      createControls: function(buttons) {
        buttons.appendChild(document.createTextNode('From'));
        buttons.appendChild(CATMAID.skeletonListSources.createSelect(this));

        var add = document.createElement('input');
        add.setAttribute("type", "button");
        add.setAttribute("value", "Append as group");
        add.onclick = this.loadSource.bind(this);
        buttons.appendChild(add);

        var clear = document.createElement('input');
        clear.setAttribute("type", "button");
        clear.setAttribute("value", "Clear");
        clear.onclick = this.clear.bind(this);
        buttons.appendChild(clear);

        var svg = document.createElement('input');
        svg.setAttribute("type", "button");
        svg.setAttribute("value", "Export SVG");
        svg.onclick = this.exportSVG.bind(this);
        buttons.appendChild(svg);

        var sel = document.createElement('span');
        sel.innerHTML = ' Selected: <span id="venn_diagram_sel' + this.widgetID + '">none</span>';
        buttons.appendChild(sel);
      },
      contentID: 'venn_diagram_div' + this.widgetID
    };
  };

  VennDiagram.prototype.destroy = function() {
    this.unregisterInstance();
    this.unregisterSource();

    Object.keys(this).forEach(function(key) { delete this[key]; }, this);
  };

  VennDiagram.prototype.clear = function() {
    this.groups = [];
    this.selected = {};
    delete this.diagram;
    $('#venn_diagram_div' + this.widgetID).empty();
  };

  VennDiagram.prototype.getSkeletonModels = function() {
      return this.groups.reduce(function(o, group) {
          return Object.keys(group.models).reduce(function(o, skid) {
              o[skid] = group.models[skid];
              return o;
          }, o);
      }, {});
  };

  VennDiagram.prototype.getSkeletonModel = function(skid) {
    for (var i=0; i<this.groups.length; ++i) {
      var model = this.groups[i].models[skid];
      if (model) return model;
    }
    return null;
  };

  VennDiagram.prototype.getSelectedSkeletonModels = function() {
      return this.selected;
  };

  /** Appends skeletons as a group*/
  VennDiagram.prototype.append = function(models) {
      var visibleModels = Object.keys(models).reduce(function(o, skid) {
          var model = models[skid];
          if (model.selected) o[skid] = model;
          return o;
      }, {});
      if (0 === Object.keys(visibleModels).length) return;

      // Add new group
      var options = new CATMAID.OptionsDialog("Group properties");
      options.appendField("Name:", "vd-name", "", null);

      var groupColor = '#aaaaff';
      var colorButton = document.createElement('button');
      colorButton.appendChild(document.createTextNode('Color'));
      options.dialog.appendChild(colorButton);
      CATMAID.ColorPicker.enable(colorButton, {
        initialColor: groupColor,
        onColorChange: function(rgb, alpha, colorChanged, alphaChanged) {
          if (colorChanged) {
            groupColor = CATMAID.tools.rgbToHex(Math.round(rgb.r * 255),
                Math.round(rgb.g * 255), Math.round(rgb.b * 255));
          }
        }
      });

      var self = this;

      options.onOK = function() {
          var label = $('#vd-name').val();
          if (label && label.length > 0) label = label.trim();
          else {
              return alert("Must provide a group name!");
          }
          self.groups.push(new CATMAID.SkeletonGroup(
                      visibleModels,
                      label,
                      new THREE.Color(groupColor)));

          // Reorder from large to small, so that small ones end up on top
          self.groups.sort(function(g1, g2) {
              var s1 = Object.keys(g1.models).length,
                  s2 = Object.keys(g2.models).length;
              return s1 === s2 ? 0 : (s1 > s2 ? -1 : 1);
          });

          self.redraw();
      };

      options.show(300, 300, true);
  };

  VennDiagram.prototype.redraw = function() {
      this.sets = this.groups.map(function(group) {
          return {label: group.name + " (" + Object.keys(group.models).length + ")",
                  size: Object.keys(group.models).length};
      });

      var pairs = this.groups.map(function(group) {
          return {g: group,
                  skids: Object.keys(group.models)};
      });

      this.overlaps = [];

      for (var k=0, l=pairs.length; k<l; ++k) {
          var s1 = pairs[k].skids;
          for (var j=k+1; j<l; ++j) {
              var m2 = pairs[j].g.models;
              var common = s1.reduce(function(c, skid1) {
                  if (skid1 in m2) c[skid1] = m2[skid1];
                  return c;
              }, {});
              this.overlaps.push({
                  sets: [k, j],
                  size: Object.keys(common).length, // can be zero
                  common: common});
          }
      }

      this.draw();
  };

  VennDiagram.prototype.draw = function() {
    var containerID = '#venn_diagram_div' + this.widgetID,
        container = $(containerID);

    // Clear existing plot if any
    container.empty();

    if (0 === this.groups.length || !this.sets || !this.overlaps) return;

    // Dimensions and padding
    var margin = {top: 20, right: 20, bottom: 30, left: 40},
        width = container.width() - margin.left - margin.right,
        height = container.height() - margin.top - margin.bottom;

    var positions;
    if (this.groups.length > 3) positions = venn.venn(this.sets, this.overlaps, {layoutFunction: venn.classicMDSLayout});
    else positions = venn.venn(this.sets, this.overlaps);

    var parameters = {
        opacity: 0.4,
        textStrokeColours: function() { return 'none'; },
        textFillColours: (function(i) {
            // To psychodelic:
            // return '#' + this.groups[i].color.clone().offsetHSL(0.5, 0, 0).getHexString();
            return '#000000';
          }).bind(this),
        circleFillColours: (function(i) {
            return '#' + this.groups[i].color.getHexString();
          }).bind(this)
    };

    this.diagram = venn.drawD3Diagram(d3.select(containerID), positions, width, height, parameters);

    var self = this;

    var click = function(d, i) {
        // Clear selection
        self.selected = {};
        var label = $('#venn_diagram_sel' + self.widgetID);
        label.empty();

        // Check if removing a group
        if (d3.event.shiftKey) {
            if (confirm("Remove group '" + self.sets[i].label + "' ?")) {
               self.groups.splice(i, 1);
               self.redraw();
            }
            return;
        }

        // find circles intersected by the click
        var e = d3.mouse(this),
            x = e[0],
            y = e[1],
            intersecting = [];
        self.diagram.svg.selectAll('circle').each(function(circle, k) {
            var dx = circle.x - x,
                dy = circle.y - y,
                d = dx * dx + dy * dy;
            if (d < circle.radius * circle.radius) {
                intersecting.push(k);
            }
        });

        if (intersecting.length > 1) {
            // Potential intersection (may be false due to layout impossibility)
            var search = self.overlaps.reduce(function(r, overlap) {
                if (0 === overlap.size) {
                    r.n_empty += 1;
                    return r;
                }
                if (   -1 !== intersecting.indexOf(overlap.sets[0])
                    && -1 !== intersecting.indexOf(overlap.sets[1])) {
                    Object.keys(overlap.common).reduce(function(models, skid) {
                        models[skid] = overlap.common[skid];
                        return models;
                    }, r.models);
                    return r;
                }
                return r;
            }, {n_empty: 0, models: {}});

            if (search.n_empty === intersecting.length -1 && 0 === Object.keys(search.models).length) {
                // False intersection, it's a single group
                intersecting = intersecting.filter(function(k) { return k > 0; });
            }
        }

        if (intersecting.length > 1) {
            self.selected = search.models;
            var size = Object.keys(self.selected).length;
            label.text("intersection with " + size + " neuron" + (1 === size ? "" : "s") + ".");
        } else {
            // Single group: subtract all its overlaps
            var k = intersecting[0];
            self.selected = self.overlaps.reduce(function(s, overlap) {
                return -1 === overlap.sets.indexOf(k) ?
                  s
                  : Object.keys(overlap.common).reduce(function(s, skid) {
                      delete s[skid];
                      return s;
                  }, s);
            }, $.extend({}, self.groups[k].models));

            var size = Object.keys(self.selected).length;
            label.text("subset of " + size + " neuron" + (size > 1 ? "s" : "") + " from " + self.groups[k].name + ".");
        }
    };

    this.diagram.circles
      .on("mouseover", function(d, i) {
          d3.select(this).style("fill-opacity", 0.8);
          d3.select(this).style("stroke-width", 2);
      })
      .on("mouseout", function(d, i) {
          d3.select(this).style("fill-opacity", 0.4);
          d3.select(this).style("stroke-width", 0);
      })
      .on("click", click);

    this.diagram.text
      .on("click", click);
  };

  VennDiagram.prototype.exportSVG = function() {
    if (0 === this.groups.length || !this.sets || !this.overlaps) return;
    CATMAID.svgutil.saveDivSVG('venn_diagram_div' + this.widgetID,
        "venn_diagram.svg");
  };

  VennDiagram.prototype.resize = function() {
    var now = new Date();
    // Overwrite request log if any
    this.last_request = now;

    setTimeout((function() {
      if (this.last_request && now === this.last_request) {
        delete this.last_request;
        this.draw();
      }
    }).bind(this), 1000);
  };

  VennDiagram.prototype.highlight = function(skeleton_id) {
      // TODO
  };

  /**
   * Returns array of CATMAID.SkeletonGroup instances
   * Implements duck-typing interface SkeletonGroupSource
   */
  VennDiagram.prototype.getGroups = function() {
    return this.groups.map(function(group) { return group.clone(); });
  };

  /**
   * Returns array of CATMAID.SkeletonGroup instances with a single entry for the selected skeletons if any
   * Implements duck-typing interface SkeletonGroupSource
   */
  VennDiagram.prototype.getSelectedGroups = function() {
    if (0 === Object.keys(this.selected).length) return [];
    var label = $('#venn_diagram_sel' + this.widgetID);
    return [new CATMAID.SkeletonGroup($.extend({}, this.selected), label.text(), new THREE.Color(1, 1, 0))];
  };

  // Export widget into CATMAID namespace
  CATMAID.VennDiagram = VennDiagram;

  // Register widget with CATMAID
  CATMAID.registerWidget({
    name: "Venn Diagram",
    description: "Use set logic to filter skeletons",
    key: 'venn-diagram',
    creator: VennDiagram
  });

})(CATMAID);
