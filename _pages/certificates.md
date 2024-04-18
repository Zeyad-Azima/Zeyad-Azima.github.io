---
layout: archive
permalink: /Certificates/
title: "Certificates"
author_profile: true
---

{% assign tag_filter = "certificates" %}
{% assign filtered_posts = site.posts | where_exp: "post", "post.tags contains tag_filter" %}

<div class="tagged-posts">
    <h2 id="{{ tag_filter | slugify }}" class="archive__subtitle">{{ tag_filter }}</h2>
    {% if filtered_posts.size > 0 %}
        {% for post in filtered_posts %}
            {% include archive-single.html %}
        {% endfor %}
    {% else %}
        <p>No posts found with the tag '{{ tag_filter }}'.</p>
    {% endif %}
</div>
